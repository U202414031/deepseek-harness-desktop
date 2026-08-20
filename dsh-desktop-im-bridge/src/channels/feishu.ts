/**
 * 飞书 (Feishu / Lark) 通道适配器。
 *
 * 出站：官方 OpenAPI（tenant_access_token + im/v1/messages）发送文本，完整实现。
 * 入站：使用飞书「长连接」（WebSocket）事件订阅，**无需公网回调地址**：
 *   - 在飞书开放平台创建自建应用，开启「机器人」能力；
 *   - 「事件订阅 → 长连接」订阅 `im.message.receive_v1` 事件；
 *   - 本机 WebSocket 连到官方长连接网关，实时接收消息并转发 DeepSeek，回复原路返回。
 *
 * 长连接协议（官方文档「使用长连接接收事件」）：
 *   - 连接地址 wss://open.feishu.cn/open-apis/event/v1/websocket，
 *     请求头带 `Authorization: Bearer <tenant_access_token>`；
 *   - 连接建立后服务端下发 `challenge` 校验帧，客户端须回 `{"challenge": <值>}`；
 *   - 服务端定期下发 `ping`（含 ws_id），客户端回 `{"type":"pong","ws_id": <值>}` 保活；
 *   - 事件帧为 `{"schema":"2.0","header":{"event_type":...},"event":{...}}`。
 */

import type {
  ImChannelAdapter,
  ImChannelConfig,
  ImChannelStatus,
  ImGatewayContext,
  ImOutboundStream,
} from '../types.ts'
import { installImGatewayCrashGuard } from '../crash-guard.ts'

const TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'
const MSG_URL = 'https://open.feishu.cn/open-apis/im/v1/messages'
/** 飞书事件订阅「长连接」网关。 */
const WS_URL = 'wss://open.feishu.cn/open-apis/event/v1/websocket'

/** 长连接下发的一帧。 */
interface WsFrame {
  type?: string
  challenge?: string
  ws_id?: string
  schema?: string
  header?: {
    event_type?: string
    app_id?: string
    [key: string]: unknown
  }
  event?: FeishuEventBody
}

/** im.message.receive_v1 事件体。 */
interface FeishuEventBody {
  sender?: {
    sender_id?: { open_id?: string; user_id?: string; union_id?: string }
    sender_type?: string
  }
  message?: {
    message_id?: string
    chat_id?: string
    chat_type?: string
    msg_type?: string
    content?: string
    create_time?: string
    mentions?: Array<{ key?: string; name?: string }>
    [key: string]: unknown
  }
  [key: string]: unknown
}

/**
 * 从一条长连接事件帧里提取文本消息（仅 `im.message.receive_v1` 的文本消息；
 * 群聊要求机器人被 @）。提取不到时返回 undefined。
 */
export function extractFeishuTextEvent(
  payload: unknown,
): { chatId: string; senderId: string; text: string; raw: unknown } | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const frame = payload as WsFrame
  if (frame.header?.event_type !== 'im.message.receive_v1' || !frame.event) return undefined
  const msg = frame.event.message
  if (!msg || msg.msg_type !== 'text') return undefined
  // 群聊里只处理被 @ 机器人的消息，避免机器人把全群消息都接进来。
  if (msg.chat_type === 'group' && !(Array.isArray(msg.mentions) && msg.mentions.length > 0)) {
    return undefined
  }
  let text = ''
  try {
    const parsed = JSON.parse(msg.content ?? '{}') as { text?: string }
    text = (parsed.text ?? '').trim()
  } catch {
    return undefined
  }
  const chatId = msg.chat_id ?? ''
  const senderId = frame.event.sender?.sender_id?.open_id ?? frame.event.sender?.sender_id?.user_id ?? ''
  if (!chatId || !text) return undefined
  return { chatId, senderId, text, raw: frame.event }
}

/**
 * 飞书通道适配器：出站走 OpenAPI，入站走长连接 WebSocket。
 * 把「飞书里与机器人单聊」变成与 DeepSeek 对话的窗口。
 */
export class FeishuChannel implements ImChannelAdapter {
  readonly type: 'feishu' = 'feishu'
  private connected = false
  private cred: { appId: string; appSecret: string } | undefined
  private config: ImChannelConfig | undefined
  private gateway: ImGatewayContext | undefined
  /** tenant_access_token（过期前自动刷新）。 */
  private token = ''
  private tokenExpireAt = 0
  /** 长连接 WebSocket。 */
  private ws: any
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private reconnectDelay = 3000
  private destroyed = false
  /** 定期检查 token 是否即将过期（过期前主动断开以触发重连换新 token）。 */
  private expireCheckTimer: ReturnType<typeof setInterval> | undefined
  /** 连接状态说明（展示在 UI）。 */
  private loginTip = ''

  async connect(config: ImChannelConfig, gateway: ImGatewayContext): Promise<void> {
    this.config = config
    this.gateway = gateway
    // 全局防崩网：确保网关相关未捕获 rejection 绝不杀掉桌面端。
    installImGatewayCrashGuard()

    const appId = config.config.appId?.trim()
    const appSecret = config.config.appSecret?.trim()
    if (!appId || !appSecret) {
      this.loginTip = '需要 App ID 与 App Secret（在飞书开放平台创建自建应用后填写）'
      throw new Error('飞书通道需要 appId 与 appSecret')
    }
    // 凭证没变且已在线 → 复用，避免反复建连接。
    if (
      this.cred &&
      this.cred.appId === appId &&
      this.cred.appSecret === appSecret &&
      this.ws
    ) {
      console.log('[im-gateway:feishu] 复用已有长连接（凭证未变）')
      return
    }
    this.disconnect()
    this.cred = { appId, appSecret }
    this.destroyed = false
    this.reconnectDelay = 3000

    await this.openGateway()
    console.log('[im-gateway:feishu] connect() 完成，等待飞书消息…')
  }

  /** 获取 tenant_access_token（官方 API 鉴权）。带超时，避免网络挂起卡死 reload。 */
  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpireAt - 60_000) return this.token
    const cred = this.cred
    if (!cred) throw new Error('飞书凭证未初始化')
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app_id: cred.appId, app_secret: cred.appSecret }),
        signal: ctrl.signal,
      })
      const data = (await res.json()) as {
        code?: number
        msg?: string
        tenant_access_token?: string
        expire?: number
      }
      if (data.code !== 0 || !data.tenant_access_token) {
        throw new Error(`获取飞书 tenant_access_token 失败: ${data.msg ?? data.code ?? res.status}`)
      }
      this.token = data.tenant_access_token
      this.tokenExpireAt = Date.now() + (data.expire ?? 7200) * 1000
      return this.token
    } catch (cause) {
      if ((cause as Error)?.name === 'AbortError') {
        throw new Error('获取飞书 token 超时（15 秒），请检查网络后重试')
      }
      throw cause
    } finally {
      clearTimeout(timer)
    }
  }

  /** 建立长连接 WebSocket（带超时，避免网络挂起卡死 reload）。 */
  private async openGateway(): Promise<void> {
    const cred = this.cred
    if (!cred || this.destroyed) return
    const token = await this.ensureToken()
    // 动态载入 ws（打包 external，运行期由 Node 解析；ws 已在依赖树里）。
    const { default: WS } = (await import('ws')) as any
    if (this.destroyed) return
    const ws = new WS(WS_URL, {
      headers: { authorization: `Bearer ${token}` },
    })
    this.ws = ws
    // 不持有 Node 事件循环（见 QQ 通道注释）：桌面端由宿主进程保活，无头进程可正常退出。
    ws.unref?.()
    ws.on('open', () => {
      this.connected = true
      this.loginTip = '已连接（飞书长连接，单聊机器人即可对话）'
    })
    ws.on('message', (data: Buffer) => void this.handleWsData(data))
    ws.on('close', () => {
      this.connected = false
      console.log('[im-gateway:feishu] 长连接已关闭，稍后重连…')
      this.scheduleReconnect()
    })
    ws.on('error', (e: Error) => {
      console.error('[im-gateway:feishu] 长连接错误（已忽略）:', e?.message ?? e)
    })
    this.startExpireCheck()
  }

  /** 处理长连接帧：challenge 校验、ping/pong 心跳、事件推送。 */
  private async handleWsData(data: Buffer): Promise<void> {
    try {
      const frame = JSON.parse(data.toString()) as WsFrame
      if (frame.type === 'challenge' && frame.challenge) {
        // 长连接校验：原样回传 challenge 值。
        this.ws?.send(JSON.stringify({ challenge: frame.challenge }))
        this.connected = true
        this.loginTip = '已连接（飞书长连接，单聊机器人即可对话）'
        console.log('[im-gateway:feishu] 长连接校验通过，飞书机器人已上线')
        return
      }
      if (frame.type === 'ping') {
        // 心跳保活：回复 pong（带 ws_id）。
        this.ws?.send(JSON.stringify({ type: 'pong', ws_id: frame.ws_id ?? '' }))
        return
      }
      if (frame.type === 'pong') {
        return
      }
      if (frame.header?.event_type === 'im.message.receive_v1') {
        await this.handleMessageEvent(frame)
        return
      }
    } catch (e) {
      console.error('[im-gateway:feishu] 处理长连接帧失败（已忽略）:', e)
    }
  }

  /** 处理一条收到的事件（仅文本消息转发给网关）。 */
  private async handleMessageEvent(frame: WsFrame): Promise<void> {
    try {
      if (!this.gateway || !this.config) return
      const extracted = extractFeishuTextEvent(frame)
      if (!extracted) return
      await this.gateway.handleInbound({
        channel: 'feishu',
        channelId: this.config.id,
        // 单聊与群聊都用 chat_id 作为会话标识；回复时按 chat_id 原路返回。
        conversationId: extracted.chatId,
        senderId: extracted.senderId,
        senderName: extracted.senderId,
        text: extracted.text,
        raw: extracted.raw,
      })
    } catch (e) {
      console.error('[im-gateway:feishu] 处理飞书事件失败（已忽略）:', e)
    }
  }

  /** 定期检查 token 是否即将过期：是则主动断开长连接，触发重连换新 token。 */
  private startExpireCheck(): void {
    this.stopExpireCheck()
    this.expireCheckTimer = setInterval(() => {
      if (this.destroyed || !this.ws || !this.token) return
      if (Date.now() > this.tokenExpireAt - 120_000) {
        console.log('[im-gateway:feishu] token 即将过期，主动重连长连接…')
        try {
          this.ws.close()
        } catch {
          /* ignore */
        }
      }
    }, 60_000)
    this.expireCheckTimer.unref?.()
  }

  private stopExpireCheck(): void {
    if (this.expireCheckTimer) {
      clearInterval(this.expireCheckTimer)
      this.expireCheckTimer = undefined
    }
  }

  disconnect(): void {
    this.destroyed = true
    this.connected = false
    this.stopExpireCheck()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    try {
      this.ws?.close?.()
    } catch {
      /* ignore */
    }
    this.ws = undefined
  }

  /** 长连接断线后指数退避重连（不无限打日志）。 */
  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      if (this.destroyed || !this.cred) return
      console.log(`[im-gateway:feishu] ${this.reconnectDelay}ms 后重连长连接…`)
      void this.openGateway().catch((e: unknown) => {
        console.error('[im-gateway:feishu] 重连失败（稍后再试）:', e instanceof Error ? e.message : e)
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60_000)
        this.scheduleReconnect()
      })
    }, this.reconnectDelay)
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
        if (buffer.length > 0) {
          void this.sendText(conversationId, buffer).catch((e) =>
            console.error('[im-gateway:feishu] 发送失败（已忽略）:', e),
          )
        }
      },
      fail: (error: string) => {
        void this.sendText(conversationId, `⚠️ ${error}`).catch((e) =>
          console.error('[im-gateway:feishu] 发送失败（已忽略）:', e),
        )
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
      detail: this.connected
        ? '已连接（飞书长连接，可收发消息）'
        : this.loginTip || '未连接（请填 AppID/AppSecret 后启用）',
    }
  }
}
