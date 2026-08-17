/**
 * 飞书 (Feishu / Lark) channel adapter.
 *
 * Implements the {@link ImChannelAdapter} contract so it slots into the unified
 * gateway. Outbound (sending) is fully implemented via the official OpenAPI
 * (tenant_access_token + im/v1/messages). Inbound message delivery requires
 * subscribing to Feishu events (WebSocket long-connection or a callback URL);
 * that subscription is intentionally left as a clearly-marked extension point so
 * the adapter compiles and sends today, and can be wired to live inbound later.
 */

import type {
  ImChannelAdapter,
  ImChannelConfig,
  ImChannelStatus,
  ImGatewayContext,
  ImOutboundStream,
} from '../types.ts'

const TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'
const MSG_URL = 'https://open.feishu.cn/open-apis/im/v1/messages'

export class FeishuChannel implements ImChannelAdapter {
  readonly type: 'feishu' = 'feishu'
  private connected = false
  private config: ImChannelConfig | undefined
  private token: string | undefined

  async connect(config: ImChannelConfig, _gateway: ImGatewayContext): Promise<void> {
    this.config = config
    // Validate credentials eagerly so misconfiguration surfaces at connect time.
    if (!config.config.appId || !config.config.appSecret) {
      throw new Error('飞书通道需要 appId 与 appSecret')
    }
    await this.ensureToken()
    this.connected = true
    // TODO(inbound): subscribe to Feishu events (ws long-connection / callback)
    // and forward each received message to `this.gateway.handleInbound(...)`.
  }

  disconnect(): void {
    this.connected = false
    this.token = undefined
  }

  private async ensureToken(): Promise<string> {
    if (this.token) return this.token
    if (!this.config) throw new Error('飞书通道未初始化')
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        app_id: this.config.config.appId,
        app_secret: this.config.config.appSecret,
      }),
    })
    const data = (await res.json()) as { code?: number; msg?: string; tenant_access_token?: string; expire?: number }
    if (data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`飞书获取 token 失败: ${data.msg ?? data.code ?? 'unknown'}`)
    }
    this.token = data.tenant_access_token
    return this.token
  }

  async sendText(conversationId: string, text: string): Promise<void> {
    const token = await this.ensureToken()
    const res = await fetch(`${MSG_URL}?receive_id_type=chat_id`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        receive_id: conversationId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
    })
    const data = (await res.json()) as { code?: number; msg?: string }
    if (data.code !== 0) {
      throw new Error(`飞书发送失败: ${data.msg ?? data.code ?? 'unknown'}`)
    }
  }

  beginStream(conversationId: string): ImOutboundStream {
    let buffer = ''
    return {
      streamText: (chunk: string) => {
        buffer += chunk
      },
      end: () => {
        if (buffer.length > 0) void this.sendText(conversationId, buffer)
      },
      fail: (error: string) => {
        void this.sendText(conversationId, `⚠️ ${error}`)
      },
    }
  }

  getStatus(): ImChannelStatus {
    return {
      type: 'feishu',
      id: this.config?.id ?? 'feishu',
      name: this.config?.name ?? '飞书',
      enabled: this.config?.enabled ?? false,
      connected: this.connected,
      detail: this.connected ? '已连接（出站可用，入站待接入事件订阅）' : '未连接',
    }
  }
}
