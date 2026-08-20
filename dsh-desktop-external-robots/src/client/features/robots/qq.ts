import type {
  Connector, PlatformField, PlatformMessage, PlatformMeta, PlatformTarget, SendResult,
} from './platform-types.ts'
import { proxyFetch } from '../../http-proxy.ts'

const QQ_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'
const QQ_API_PRODUCTION = 'https://api.sgroup.qq.com'

/**
 * QQ 业务 API 请求（统一走正式主机）。沙箱自动回退由主进程代理完成：
 * 正式环境返回 11001「不支持的调用」/ 11263 / 130003 / 130005 等未上架指示码时，
 * 代理会在主进程内自动改调 sandbox.api.sgroup.qq.com 并返回其结果，
 * 渲染进程全程只处理一个响应，避免客户端二次请求在回环连接上失败。
 */
async function qqApiFetch(path: string, token: string, init?: { method?: string; body?: string }): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `QQBot ${token}` }
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json'
  const requestInit: RequestInit = { method: init?.method ?? 'GET', headers }
  if (init?.body !== undefined) requestInit.body = init.body
  return proxyFetch(`${QQ_API_PRODUCTION}${path}`, requestInit)
}

const FIELDS: PlatformField[] = [
  { key: 'appId', label: '机器人 AppID', placeholder: 'QQ 开放平台机器人 AppID' },
  { key: 'clientSecret', label: '机器人密钥', secret: true, placeholder: 'QQ 开放平台机器人密钥' },
]

const META: PlatformMeta = {
  id: 'qq',
  label: 'QQ (机器人开放平台)',
  short: 'QQ',
  emoji: '🐧',
  accent: '#12b7f5',
  docUrl: 'https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/access-token.html',
  fields: FIELDS,
  supportsFetch: true,
  targetMode: 'select',
  targetLabel: '接收群',
  targetTypes: [
    { id: 'group', label: '群', input: 'select' },
    { id: 'c2c', label: '私聊(对象)', input: 'text', placeholder: '对方 user_openid（当对方发消息给机器人时，可从消息事件中取得）' },
  ],
  note: '需先在 QQ 开放平台创建机器人。新机器人默认「开发中」沙箱环境，未上架时发消息/列群会自动改用沙箱主机调试；发消息到真实群需机器人上架审核通过。群消息读取通常需机器人具备相应权限且群已授权；私聊历史需经机器人网关实时接收，REST 不支持拉取，可粘贴消息后总结。',
}

interface TokenResponse {
  code?: number
  message?: string
  access_token?: string
  expires_in?: number
  /** QQ 官方接口把 access_token 嵌套在 data 内；代理层错误时还会带 error 字段。 */
  data?: { access_token?: string; expires_in?: number }
  error?: string
}

interface GroupsResponse {
  data?: Array<{ group_openid: string; group_name?: string }>
}

interface MessagesResponse {
  data?: Array<{ id: string; content?: string; author?: { username?: string; id?: string }; timestamp?: string }>
}

export const qqConnector: Connector = {
  meta: META,

  async connect(values: Record<string, string>): Promise<string> {
    const appId = values.appId?.trim()
    const clientSecret = values.clientSecret?.trim()
    if (!appId || !clientSecret) throw new Error('请填写机器人 AppID 与密钥。')
    let response: Response
    try {
      response = await proxyFetch(QQ_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, clientSecret }),
      })
    } catch (e) {
      throw new Error(`无法访问 QQ 开放平台：${e instanceof Error ? e.message : String(e)}`)
    }
    let data: TokenResponse
    try {
      data = await response.json() as TokenResponse
    } catch {
      throw new Error(`获取访问令牌失败：接口返回了非 JSON 内容（HTTP ${response.status}），网络可能被拦截或不可达。`)
    }
    // 主进程代理在无法连接上游时会返回 { ok:false, error }，把真实原因透传出来。
    if (typeof data.error === 'string' && data.error.length > 0) {
      throw new Error(`无法访问 QQ 开放平台：${data.error}`)
    }
    // QQ 官方接口把 access_token 嵌套在 data 内（{code,message,data:{access_token}}），
    // 部分网关/旧版返回在顶层，两种都兼容。
    const token = data.access_token ?? data.data?.access_token
    if (!token) {
      const code = data.code === undefined ? '?' : String(data.code)
      const message = data.message ?? '未知错误'
      throw new Error(
        `获取访问令牌失败：${message}（code ${code}）。请检查：① 填写的是「机器人」的 AppID / AppSecret（不是开发者凭证）；② 密钥未被重置且复制完整；③ 机器人状态正常；④ 本机网络可访问 bots.qq.com。`,
      )
    }
    return token
  },

  async sendMessage(token: string, target: string, text: string, opts?: { targetType?: string }): Promise<SendResult> {
    const targetType = opts?.targetType ?? 'group'
    const path =
      targetType === 'c2c'
        ? `/v2/users/${encodeURIComponent(target)}/messages`
        : `/v2/groups/${encodeURIComponent(target)}/messages`
    try {
      const response = await qqApiFetch(path, token, { method: 'POST', body: JSON.stringify({ content: text, msg_type: 0 }) })
      const data = await response.json() as { code?: number; message?: string; error?: string }
      if (typeof data.error === 'string' && data.error.length > 0) {
        return { ok: false, message: `发送失败：${data.error}` }
      }
      if (!response.ok || data.code !== 0) {
        return { ok: false, message: `发送失败：${data.message ?? `HTTP ${response.status}`}` }
      }
      return { ok: true, message: targetType === 'c2c' ? '已发送给该对象' : '已发送到群' }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? `发送失败：${e.message}` : '发送失败：网络错误' }
    }
  },

  async listTargets(token: string): Promise<PlatformTarget[]> {
    const response = await qqApiFetch('/v2/groups', token)
    const data = await response.json() as GroupsResponse & { code?: number; message?: string; error?: string }
    if (typeof data.error === 'string' && data.error.length > 0) {
      throw new Error(`获取群列表失败：${data.error}`)
    }
    if (data.code !== undefined && data.code !== 0) {
      throw new Error(`获取群列表失败：${data.message ?? `code ${data.code}`}`)
    }
    if (!response.ok) {
      throw new Error(`获取群列表失败：HTTP ${response.status}`)
    }
    const items = data.data ?? []
    return items.map((g) => ({ id: g.group_openid, name: g.group_name || g.group_openid }))
  },

  async fetchMessages(token: string, target: string, opts?: { targetType?: string }): Promise<PlatformMessage[]> {
    const targetType = opts?.targetType ?? 'group'
    if (targetType === 'c2c') {
      throw new Error(
        'QQ 私聊历史消息需经机器人网关实时接收，REST 接口不支持拉取。请复制对方发来的消息后，在「信息总结」中粘贴并总结。',
      )
    }
    const response = await qqApiFetch(
      `/v2/groups/${encodeURIComponent(target)}/messages?limit=20`,
      token,
    )
    if (!response.ok) {
      throw new Error(`获取群消息失败：HTTP ${response.status}（QQ 群历史通常需经网关接收，REST 拉取可能为空）`)
    }
    const data = await response.json() as MessagesResponse & { code?: number; message?: string }
    if (data.code !== undefined && data.code !== 0) {
      throw new Error(`获取群消息失败：${data.message ?? `code ${data.code}`}`)
    }
    const items = data.data ?? []
    if (items.length === 0) {
      throw new Error('未拉取到消息（QQ 群历史通常需经网关接收，REST 拉取可能为空）。可粘贴消息后在「信息总结」中总结。')
    }
    return items.map((m) => ({
      id: m.id,
      sender: m.author?.username ?? '未知',
      text: m.content ?? '[空消息]',
      time: m.timestamp ?? '',
    }))
  },
}
