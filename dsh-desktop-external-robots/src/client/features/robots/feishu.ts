import type {
  Connector, PlatformField, PlatformMessage, PlatformMeta, PlatformTarget, SendResult,
} from './platform-types.ts'
import { proxyFetch } from '../../http-proxy.ts'

const FEISHU_BASE = 'https://open.feishu.cn/open-apis'

const FIELDS: PlatformField[] = [
  { key: 'appId', label: 'App ID', placeholder: 'cli_xxxxxxxxxxxxxxxx' },
  { key: 'appSecret', label: 'App Secret', secret: true, placeholder: '应用凭证密钥' },
]

const META: PlatformMeta = {
  id: 'feishu',
  label: '飞书 (Feishu / Lark)',
  short: '飞书',
  emoji: '🟦',
  accent: '#3370ff',
  docUrl: 'https://open.feishu.cn/document/ukTMukTMukTM/uczNzUjL3czM14yN3MTN',
  fields: FIELDS,
  supportsFetch: true,
  targetMode: 'select',
  targetLabel: '接收会话',
  note: '需先在飞书开放平台创建企业自建应用，开启「发送消息」与「读取消息」权限，并添加至可用范围。',
}

interface TokenResponse {
  code?: number
  msg?: string
  tenant_access_token?: string
}

interface ChatsResponse {
  code?: number
  msg?: string
  data?: { items?: Array<{ chat_id: string; name: string }> }
}

interface MessagesResponse {
  code?: number
  msg?: string
  data?: {
    items?: Array<{
      message_id: string
      msg_type: string
      content: string
      sender?: { name?: string; id?: string }
      create_time?: string
    }>
  }
}

function readText(content: string, msgType: string): string {
  if (msgType === 'text') {
    try {
      const parsed = JSON.parse(content) as { text?: string }
      return parsed.text ?? content
    } catch {
      return content
    }
  }
  if (msgType === 'image') return '[图片]'
  if (msgType === 'file') return '[文件]'
  if (msgType === 'post') {
    try {
      const parsed = JSON.parse(content) as { title?: string }
      return parsed.title ?? '[富文本]'
    } catch {
      return '[富文本]'
    }
  }
  return `[${msgType}]`
}

export const feishuConnector: Connector = {
  meta: META,

  async connect(values: Record<string, string>): Promise<string> {
    const appId = values.appId?.trim()
    const appSecret = values.appSecret?.trim()
    if (!appId || !appSecret) throw new Error('请填写 App ID 与 App Secret。')
    const response = await proxyFetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    })
    if (!response.ok) throw new Error(`获取访问令牌失败：HTTP ${response.status}`)
    const data = await response.json() as TokenResponse
    if (data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`获取访问令牌失败：${data.msg ?? '未知错误'}（code ${data.code ?? '?'})`)
    }
    return data.tenant_access_token
  },

  async sendMessage(token: string, target: string, text: string, _opts?: { targetType?: string }): Promise<SendResult> {
    try {
      const response = await proxyFetch(`${FEISHU_BASE}/im/v1/messages?receive_id_type=chat_id`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ receive_id: target, msg_type: 'text', content: JSON.stringify({ text }) }),
      })
      const data = await response.json() as { code?: number; msg?: string }
      if (!response.ok || data.code !== 0) {
        return { ok: false, message: `发送失败：${data.msg ?? `HTTP ${response.status}`}` }
      }
      return { ok: true, message: '已发送' }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? `发送失败：${e.message}` : '发送失败：网络错误' }
    }
  },

  async listTargets(token: string): Promise<PlatformTarget[]> {
    const response = await proxyFetch(`${FEISHU_BASE}/im/v1/chats?page_size=50`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await response.json() as ChatsResponse
    if (data.code !== 0) throw new Error(data.msg ?? '获取会话列表失败')
    return (data.data?.items ?? []).map((c) => ({ id: c.chat_id, name: c.name || c.chat_id }))
  },

  async fetchMessages(token: string, target: string, _opts?: { targetType?: string }): Promise<PlatformMessage[]> {
    const url = `${FEISHU_BASE}/im/v1/messages?container_id_type=chat&container_id=${encodeURIComponent(
      target,
    )}&page_size=20&sort_type=by_create_time_desc`
    const response = await proxyFetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const data = await response.json() as MessagesResponse
    if (data.code !== 0) throw new Error(data.msg ?? '获取消息失败')
    const items = data.data?.items ?? []
    return items.map((m) => ({
      id: m.message_id,
      sender: m.sender?.name ?? '未知',
      text: readText(m.content, m.msg_type),
      time: m.create_time ?? '',
    }))
  },
}
