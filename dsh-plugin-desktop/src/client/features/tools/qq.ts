import type {
  Connector, PlatformField, PlatformMessage, PlatformMeta, PlatformTarget, SendResult,
} from './platform-types.ts'

const QQ_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'
const QQ_API = 'https://api.sgroup.qq.com'

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
  docUrl: 'https://bot.q.qq.com/wiki/develop/api/',
  fields: FIELDS,
  supportsFetch: true,
  targetMode: 'select',
  targetLabel: '接收群',
  note: '需先在 QQ 开放平台创建机器人并审核通过。群消息读取通常需要机器人具备相应权限且群已授权。',
}

interface TokenResponse {
  code?: number
  message?: string
  access_token?: string
  expires_in?: number
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
    const response = await fetch(QQ_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', appId, clientSecret },
      body: JSON.stringify({ appId, clientSecret }),
    })
    if (!response.ok) throw new Error(`获取访问令牌失败：HTTP ${response.status}`)
    const data = await response.json() as TokenResponse
    if (!data.access_token) {
      throw new Error(`获取访问令牌失败：${data.message ?? '未知错误'}（code ${data.code ?? '?'})`)
    }
    return data.access_token
  },

  async sendMessage(token: string, target: string, text: string): Promise<SendResult> {
    try {
      const response = await fetch(`${QQ_API}/v2/groups/${encodeURIComponent(target)}/messages`, {
        method: 'POST',
        headers: { Authorization: `QQBot ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, msg_type: 0 }),
      })
      const data = await response.json() as { code?: number; message?: string }
      if (!response.ok || data.code !== 0) {
        return { ok: false, message: `发送失败：${data.message ?? `HTTP ${response.status}`}` }
      }
      return { ok: true, message: '已发送' }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? `发送失败：${e.message}` : '发送失败：网络错误' }
    }
  },

  async listTargets(token: string): Promise<PlatformTarget[]> {
    const response = await fetch(`${QQ_API}/v2/groups`, {
      headers: { Authorization: `QQBot ${token}` },
    })
    const data = await response.json() as GroupsResponse
    const items = data.data ?? []
    return items.map((g) => ({ id: g.group_openid, name: g.group_name || g.group_openid }))
  },

  async fetchMessages(token: string, target: string): Promise<PlatformMessage[]> {
    const response = await fetch(
      `${QQ_API}/v2/groups/${encodeURIComponent(target)}/messages?limit=20`,
      { headers: { Authorization: `QQBot ${token}` } },
    )
    const data = await response.json() as MessagesResponse
    const items = data.data ?? []
    return items.map((m) => ({
      id: m.id,
      sender: m.author?.username ?? '未知',
      text: m.content ?? '[空消息]',
      time: m.timestamp ?? '',
    }))
  },
}
