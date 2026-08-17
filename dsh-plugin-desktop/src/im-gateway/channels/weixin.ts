/**
 * 微信通道适配器（企业微信 / WeCom 实现）。
 *
 * 个人微信没有官方机器人 API；这里用企业微信（WeCom）自建应用实现「手机微信 ↔
 * deepseek」互通：通过 corpid/corpsecret 换取 access_token，再调用
 * cgi-bin/message/send 下发文本。入站消息需要企业微信的「接收消息」回调（或
 * 应用主页回调），同飞书一样作为清晰的扩展点预留。
 *
 * 如果你要的是「个人微信」，可参考 dsh-im-gateway 的 iLink 长轮询方案替换本文件。
 */

import type {
  ImChannelAdapter,
  ImChannelConfig,
  ImChannelStatus,
  ImGatewayContext,
  ImOutboundStream,
} from '../types.ts'

const TOKEN_URL = 'https://qyapi.weixin.qq.com/cgi-bin/gettoken'
const SEND_URL = 'https://qyapi.weixin.qq.com/cgi-bin/message/send'

export class WeixinChannel implements ImChannelAdapter {
  readonly type: 'weixin' = 'weixin'
  private connected = false
  private config: ImChannelConfig | undefined
  private token: string | undefined

  async connect(config: ImChannelConfig, _gateway: ImGatewayContext): Promise<void> {
    this.config = config
    if (!config.config.corpId || !config.config.corpSecret || !config.config.agentId) {
      throw new Error('微信(企业微信)通道需要 corpId、corpSecret、agentId')
    }
    await this.ensureToken()
    this.connected = true
    // TODO(inbound): 接入企业微信「接收消息」回调，转发到 this.gateway.handleInbound(...)
  }

  disconnect(): void {
    this.connected = false
    this.token = undefined
  }

  private async ensureToken(): Promise<string> {
    if (this.token) return this.token
    if (!this.config) throw new Error('微信通道未初始化')
    const url = `${TOKEN_URL}?corpid=${encodeURIComponent(this.config.config.corpId ?? '')}&corpsecret=${encodeURIComponent(this.config.config.corpSecret ?? '')}`
    const res = await fetch(url)
    const data = (await res.json()) as { errcode?: number; errmsg?: string; access_token?: string }
    if (data.errcode !== 0 || !data.access_token) {
      throw new Error(`微信获取 token 失败: ${data.errmsg ?? data.errcode ?? 'unknown'}`)
    }
    this.token = data.access_token
    return this.token
  }

  async sendText(conversationId: string, text: string): Promise<void> {
    const token = await this.ensureToken()
    if (!this.config) throw new Error('微信通道未初始化')
    const res = await fetch(`${SEND_URL}?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        touser: conversationId,
        msgtype: 'text',
        agentid: Number(this.config.config.agentId),
        text: { content: text },
      }),
    })
    const data = (await res.json()) as { errcode?: number; errmsg?: string }
    if (data.errcode !== 0) {
      throw new Error(`微信发送失败: ${data.errmsg ?? data.errcode ?? 'unknown'}`)
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
      type: 'weixin',
      id: this.config?.id ?? 'weixin',
      name: this.config?.name ?? '微信',
      enabled: this.config?.enabled ?? false,
      connected: this.connected,
      detail: this.connected ? '已连接（企业微信出站可用，入站待接入回调）' : '未连接',
    }
  }
}
