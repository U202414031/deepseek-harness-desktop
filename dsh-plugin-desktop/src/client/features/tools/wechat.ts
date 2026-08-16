import type {
  Connector, PlatformField, PlatformMessage, PlatformMeta, PlatformTarget, SendResult,
} from './platform-types.ts'

const WECOM_BASE = 'https://qyapi.weixin.qq.com/cgi-bin'

const FIELDS: PlatformField[] = [
  { key: 'corpid', label: '企业 ID (corpid)', placeholder: 'wwxxxxxxxxxxxxxxxx' },
  { key: 'corpsecret', label: '应用 Secret', secret: true, placeholder: '应用管理 → 自建应用 → Secret' },
  { key: 'agentid', label: '应用 AgentId', placeholder: '自建应用 AgentId' },
]

const META: PlatformMeta = {
  id: 'wechat',
  label: '微信 (企业微信 WeCom)',
  short: '微信',
  emoji: '🟢',
  accent: '#07c160',
  docUrl: 'https://developer.work.weixin.qq.com/document/path/90930',
  fields: FIELDS,
  supportsFetch: false,
  targetMode: 'text',
  targetLabel: '接收成员账号 (userid，或 @all)',
  note: '此处接入企业微信自建应用。个人微信暂无官方开放接口。企业微信不提供公开的历史消息拉取接口，「获取信息」暂不可用。',
}

interface TokenResponse {
  errcode?: number
  errmsg?: string
  access_token?: string
}

export const wechatConnector: Connector = {
  meta: META,

  async connect(values: Record<string, string>): Promise<string> {
    const corpid = values.corpid?.trim()
    const corpsecret = values.corpsecret?.trim()
    const agentid = values.agentid?.trim()
    if (!corpid || !corpsecret || !agentid) throw new Error('请填写企业 ID、应用 Secret 与 AgentId。')
    const response = await fetch(
      `${WECOM_BASE}/gettoken?corpid=${encodeURIComponent(corpid)}&corpsecret=${encodeURIComponent(corpsecret)}`,
    )
    if (!response.ok) throw new Error(`获取访问令牌失败：HTTP ${response.status}`)
    const data = await response.json() as TokenResponse
    if (data.errcode !== 0 || !data.access_token) {
      throw new Error(`获取访问令牌失败：${data.errmsg ?? '未知错误'}（errcode ${data.errcode ?? '?'})`)
    }
    // Embed agentid so send() has it without changing the connector signature.
    return `${data.access_token}::${agentid}`
  },

  async sendMessage(token: string, target: string, text: string, _opts?: { targetType?: string }): Promise<SendResult> {
    try {
      const sep = token.indexOf('::')
      const accessToken = sep >= 0 ? token.slice(0, sep) : token
      const agentid = sep >= 0 ? token.slice(sep + 2) : ''
      if (!agentid) return { ok: false, message: '缺少 AgentId，请重新连接。' }
      const response = await fetch(
        `${WECOM_BASE}/message/send?access_token=${encodeURIComponent(accessToken)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ touser: target, msgtype: 'text', agentid: Number(agentid), text: { content: text } }),
        },
      )
      const data = await response.json() as { errcode?: number; errmsg?: string }
      if (!response.ok || data.errcode !== 0) {
        return { ok: false, message: `发送失败：${data.errmsg ?? `HTTP ${response.status}`}` }
      }
      return { ok: true, message: '已发送' }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? `发送失败：${e.message}` : '发送失败：网络错误' }
    }
  },

  async listTargets(_token: string): Promise<PlatformTarget[]> {
    throw new Error('企业微信需手动填写接收成员账号，不支持自动列出。')
  },

  async fetchMessages(_token: string, _target: string, _opts?: { targetType?: string }): Promise<PlatformMessage[]> {
    throw new Error('企业微信不提供公开的历史消息拉取接口。')
  },
}
