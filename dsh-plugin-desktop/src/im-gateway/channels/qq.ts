/**
 * QQ 通道适配器（QQ 开放平台官方 Bot API v2，支持 C2C 私聊）。
 *
 * 与之前基于 icqq 逆向协议（真实 QQ 号扫码、依赖 qsign 签名服务器）的方案不同，
 * 本实现走**官方开放平台**（q.qq.com）：
 *   - 创建「机器人」应用 → 拿到 AppID + AppSecret（无需签名服务器、无封号风险）；
 *   - 开放平台「能力配置」里开通 **C2C 私聊**，沙箱模式下把测试 QQ 加为沙箱成员；
 *   - 用 WebSocket 网关（官方长连接）收 `C2C_MESSAGE_CREATE` 私聊消息，
 *     通过官方 REST API 回复，手机 QQ 里和机器人单聊即可与 DeepSeek 对话。
 *
 * 这是 cc-connect 等项目的 `qqbot` 官方通道同款机制（非 icqq 逆向协议）。
 *
 * 接入流程：
 *   1. 在 q.qq.com 创建机器人，获取 AppID / AppSecret；
 *   2. 能力配置开通 C2C 私聊；沙箱模式需把测试 QQ 加入沙箱成员；
 *   3. 在本应用「外部工具 · IM 网关」添加 QQ 通道，填 AppID / AppSecret（沙箱可选）；
 *   4. 用手机 QQ 搜索并添加该机器人为好友，发消息即转发 DeepSeek，回复原路返回。
 */

import type {
  ImChannelAdapter,
  ImChannelConfig,
  ImChannelStatus,
  ImGatewayContext,
  ImOutboundStream,
} from '../types.ts'

/** 官方机器人应用凭证。 */
interface QqBotCredential {
  appId: string
  appSecret: string
  sandbox: boolean
}

/** 官方网关分发的 WebSocket 事件。 */
interface WsPayload {
  op?: number
  t?: string
  d?: Record<string, unknown>
}

interface C2cAuthor {
  user_openid?: string
  member_openid?: string
}

interface C2cMessage {
  id?: string
  content?: string
  msg_type?: number
  author?: C2cAuthor
  [key: string]: unknown
}

/** 官方 API 端点。 */
const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'
const API_PROD = 'https://api.sgroup.qq.com'
const API_SANDBOX = 'https://sandbox.api.sgroup.qq.com'
/** GROUP_AND_C2C_EVENT：群聊 + C2C 单聊事件（含 C2C_MESSAGE_CREATE）。 */
const INTENT_GROUP_C2C = 1 << 25

/**
 * QQ 通道适配器（官方 Bot API v2，C2C 私聊模式）。
 * 把「手机 QQ 与机器人单聊」变成与 DeepSeek 对话的窗口。
 */
export class QqChannel implements ImChannelAdapter {
  readonly type: 'qq' = 'qq'
  private connected = false
  private cred: QqBotCredential | undefined
  private config: ImChannelConfig | undefined
  private gateway: ImGatewayContext | undefined
  /** access_token（官方网关鉴权用，expires_in 过期前自动刷新）。 */
  private token = ''
  private tokenExpireAt = 0
  /** WebSocket 网关连接。 */
  private ws: any
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private reconnectDelay = 3000
  private destroyed = false
  /** 发消息序号（官方要求 msg_seq 自增防重）。 */
  private msgSeq = 0
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
      this.loginTip = '需要 App ID 与 App Secret（在 q.qq.com 创建机器人后填写）'
      throw new Error('QQ 官方机器人通道需要 appId 与 appSecret')
    }
    const sandbox = config.config.sandbox?.trim() === 'true' || config.config.sandbox?.trim() === '1'
    // 凭证没变且已在线 → 复用，避免反复建连接。
    if (
      this.cred &&
      this.cred.appId === appId &&
      this.cred.appSecret === appSecret &&
      this.cred.sandbox === sandbox &&
      this.ws
    ) {
      console.log('[im-gateway:qq] 复用已有官方机器人连接（凭证未变）')
      return
    }
    this.disconnect()
    this.cred = { appId, appSecret, sandbox }
    this.destroyed = false
    this.reconnectDelay = 3000

    await this.openGateway()
    console.log('[im-gateway:qq] connect() 完成，等待官方网关消息…')
  }

  /** 获取 access_token（官方 API 鉴权）。带超时，避免网络挂起卡死 reload。 */
  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpireAt - 60_000) return this.token
    const cred = this.cred
    if (!cred) throw new Error('QQ 机器人凭证未初始化')
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appId: cred.appId, clientSecret: cred.appSecret }),
        signal: ctrl.signal,
      })
      const data = (await res.json()) as { access_token?: string; expires_in?: number; code?: number; message?: string }
      if (!data.access_token) {
        throw new Error(`获取 QQ access_token 失败: ${data.message ?? data.code ?? res.status}`)
      }
      this.token = data.access_token
      this.tokenExpireAt = Date.now() + (data.expires_in ?? 7200) * 1000
      return this.token
    } catch (cause) {
      if ((cause as Error)?.name === 'AbortError') {
        throw new Error('获取 QQ access_token 超时（15 秒），请检查网络后重试')
      }
      throw cause
    } finally {
      clearTimeout(timer)
    }
  }

  /** 取官方网关地址并建立 WebSocket 长连接。带超时，避免网络挂起卡死 reload。 */
  private async openGateway(): Promise<void> {
    const cred = this.cred
    if (!cred || this.destroyed) return
    const token = await this.ensureToken()
    const base = cred.sandbox ? API_SANDBOX : API_PROD
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    let gwRes: Response
    try {
      gwRes = await fetch(`${base}/gateway`, {
        headers: { authorization: `QQBot ${token}` },
        signal: ctrl.signal,
      })
    } catch (cause) {
      if ((cause as Error)?.name === 'AbortError') {
        throw new Error('获取 QQ 网关地址超时（15 秒），请检查网络后重试')
      }
      throw cause
    } finally {
      clearTimeout(timer)
    }
    if (!gwRes.ok) {
      throw new Error(`获取 QQ 网关地址失败: HTTP ${gwRes.status}`)
    }
    const gw = (await gwRes.json()) as { url?: string; code?: number; message?: string }
    if (!gw.url) {
      throw new Error(`获取 QQ 网关地址失败: ${gw.message ?? gw.code ?? 'unknown'}`)
    }
    // 动态载入 ws（打包 external，运行期由 Node 解析；ws 已在依赖树里）。
    const { default: WS } = (await import('ws')) as any
    if (this.destroyed) return
    const ws = new WS(gw.url, {
      headers: {
        authorization: `QQBot ${token}`,
        'x-union-appid': cred.appId,
      },
    })
    this.ws = ws
    // 不持有 Node 事件循环：Electron 桌面端由宿主进程保活，不受影响；
    // 无头冒烟/校验进程则可正常退出（否则 QQ 长连接会让进程永不退出）。
    ws.unref?.()
    ws.on('open', () => {
      this.loginTip = '网关已连接，等待 QQ 消息…'
    })
    ws.on('message', (data: Buffer) => void this.handleWsData(data))
    ws.on('close', () => {
      this.connected = false
      console.log('[im-gateway:qq] 官方网关连接已关闭，稍后重连…')
      this.scheduleReconnect()
    })
    ws.on('error', (e: Error) => {
      console.error('[im-gateway:qq] 官方网关错误（已忽略）:', e?.message ?? e)
    })
  }

  /** 处理官方网关分发的事件（含 C2C 私聊消息）。 */
  private async handleWsData(data: Buffer): Promise<void> {
    try {
      const payload = JSON.parse(data.toString()) as WsPayload
      const op = payload.op
      if (op === 10) {
        // Hello：返回心跳间隔，随后 IDENTIFY 订阅事件。
        const d = payload.d as { heartbeat_interval?: number } | undefined
        const interval = d?.heartbeat_interval ?? 30_000
        this.sendIdentify()
        this.startHeartbeat(interval)
        return
      }
      if (op === 1) {
        // 服务器要求心跳：立即补发一次。
        this.sendHeartbeat()
        return
      }
      if (op === 11) {
        // HEARTBEAT_ACK：无需处理。
        return
      }
      if (op === 0) {
        const t = payload.t
        const d = payload.d as C2cMessage | undefined
        if (t === 'READY') {
          this.connected = true
          this.loginTip = '已连接（官方 QQ 机器人，C2C 单聊可用）'
          console.log('[im-gateway:qq] 官方网关 READY，QQ 机器人已上线')
          return
        }
        if (t === 'C2C_MESSAGE_CREATE' && d) {
          await this.handleC2cMessage(d)
          return
        }
        if (t === 'GROUP_AT_MESSAGE_CREATE') {
          // 群聊暂不处理（仅 C2C 单聊）。
          return
        }
      }
    } catch (e) {
      console.error('[im-gateway:qq] 处理网关事件失败（已忽略）:', e)
    }
  }

  /** 订阅事件（IDENTIFY）。 */
  private sendIdentify(): void {
    if (!this.ws) return
    const cred = this.cred
    if (!cred) return
    void this.ensureToken()
      .then((token) => {
        this.ws?.send(
          JSON.stringify({
            op: 2,
            d: { token: `QQBot ${token}`, intents: INTENT_GROUP_C2C, shard: [0, 1] },
          }),
        )
      })
      .catch((e: unknown) => console.error('[im-gateway:qq] IDENTIFY 失败（已忽略）:', e))
  }

  private sendHeartbeat(): void {
    this.ws?.send(JSON.stringify({ op: 1, d: null }))
  }

  private startHeartbeat(interval: number): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), interval)
    // 与网关 WebSocket 一样不持有事件循环（见 openGateway 中的 unref 注释）。
    this.heartbeatTimer.unref?.()
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }

  /** 处理一条 C2C 私聊消息。 */
  private async handleC2cMessage(msg: C2cMessage): Promise<void> {
    try {
      if (!msg || !this.gateway || !this.config) return
      // 只处理纯文本消息。
      if (msg.msg_type !== 0 && msg.msg_type !== undefined) return
      const openid = msg.author?.user_openid ?? msg.author?.member_openid
      const text = typeof msg.content === 'string' ? msg.content.trim() : ''
      if (!openid || !text) return
      await this.gateway.handleInbound({
        channel: 'qq',
        channelId: this.config.id,
        conversationId: openid,
        senderId: openid,
        senderName: openid,
        text,
        raw: msg,
      })
    } catch (e) {
      console.error('[im-gateway:qq] 处理 C2C 消息失败（已忽略）:', e)
    }
  }

  disconnect(): void {
    this.destroyed = true
    this.connected = false
    this.stopHeartbeat()
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

  /** 网关断线后指数退避重连（不无限打日志）。 */
  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      if (this.destroyed || !this.cred) return
      console.log(`[im-gateway:qq] ${this.reconnectDelay}ms 后重连官方网关…`)
      void this.openGateway().catch((e: unknown) => {
        console.error('[im-gateway:qq] 重连失败（稍后再试）:', e instanceof Error ? e.message : e)
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60_000)
        this.scheduleReconnect()
      })
    }, this.reconnectDelay)
  }

  async sendText(conversationId: string, text: string): Promise<void> {
    const cred = this.cred
    if (!cred) throw new Error('QQ 机器人未配置')
    const token = await this.ensureToken()
    const base = cred.sandbox ? API_SANDBOX : API_PROD
    const res = await fetch(`${base}/v2/users/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `QQBot ${token}`,
      },
      body: JSON.stringify({
        content: text,
        msg_type: 0,
        msg_seq: ++this.msgSeq,
      }),
    })
    if (!res.ok) {
      let detail = ''
      try {
        const body = (await res.json()) as { message?: string; code?: number }
        detail = body.message ?? String(body.code ?? '')
      } catch {
        /* ignore */
      }
      throw new Error(`QQ 发送失败: HTTP ${res.status}${detail ? ` (${detail})` : ''}`)
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
            console.error('[im-gateway:qq] 发送失败（已忽略）:', e),
          )
        }
      },
      fail: (error: string) => {
        void this.sendText(conversationId, `⚠️ ${error}`).catch((e) =>
          console.error('[im-gateway:qq] 发送失败（已忽略）:', e),
        )
      },
    }
  }

  getStatus(): ImChannelStatus {
    return {
      type: 'qq',
      id: this.config?.id ?? 'qq',
      name: this.config?.name ?? 'QQ',
      enabled: this.config?.enabled ?? false,
      connected: this.connected,
      detail: this.connected
        ? '已连接（官方 QQ 机器人 C2C 单聊）'
        : this.loginTip || '未连接（请填 AppID/AppSecret 后启用）',
    }
  }
}

/**
 * 全局防崩网：接管 Node 进程里「未捕获的 rejection / 异常」的处理器。
 *
 * 背景：本仓库 `@deepseek-ai/dsh-app-boot` 的 `installFailLoud` 在整个进程生命周期
 * 注册了 `process.on('unhandledRejection', handler)`，任何未被 catch 的 rejection 都会
 * 直接 `exit(1)`（连诊断日志都不落盘）。第三方库（如 ws / 官方 SDK / 旧 icqq）内部
 * 可能有若干 fire-and-forget 的异步调用，一旦出错极易冒出未捕获 rejection 把桌面端
 * 整个拖死。
 *
 * 做法：把已注册（含 boot 的）与之后新增的 `unhandledRejection` 处理器全部收进 `captured`，
 * 改由本过滤器接管——凡是 QQ/IM 网关相关的，直接吞掉并记日志，绝不退出；其它则与原来一样
 * 交给原始处理器（保留 boot 对真实致命错误的退出行为）。同时兜底 `uncaughtException`。
 */
let crashGuardInstalled = false
function installImGatewayCrashGuard(): void {
  if (crashGuardInstalled) return
  crashGuardInstalled = true
  try {
    const isImRelated = (err: unknown): boolean => {
      const s = err instanceof Error ? err.stack ?? err.message : String(err ?? '')
      return /bot-node-sdk|resty-client|tencent-connect|im-gateway|icqq|oicq|sgroup\.qq\.com|bots\.qq\.com/i.test(s)
    }
    const proc = process as any
    const captured: Array<(e: unknown) => void> = []
    const forward = (err: unknown) => {
      for (const h of captured) {
        try {
          h(err)
        } catch {
          /* 忽略处理器自身的异常 */
        }
      }
    }
    const filter = (err: unknown) => {
      if (isImRelated(err)) {
        console.error(
          '[im-gateway] 已吞掉未捕获的 rejection（不影响桌面端）:',
          err instanceof Error ? err.message : String(err),
        )
        return
      }
      forward(err)
    }
    const existing = (typeof proc.listeners === 'function' ? proc.listeners('unhandledRejection') : []) as Array<(e: unknown) => void>
    for (const h of existing) captured.push(h)
    if (typeof proc.removeAllListeners === 'function') proc.removeAllListeners('unhandledRejection')
    if (typeof proc.on === 'function') proc.on('unhandledRejection', filter)
    const realOn = typeof proc.on === 'function' ? proc.on.bind(proc) : undefined
    if (realOn) {
      proc.on = function (this: unknown, event: string, handler: any, ...rest: any[]) {
        if (event === 'unhandledRejection' && typeof handler === 'function') {
          captured.push(handler)
          return realOn.call(proc, event, filter, ...rest)
        }
        return realOn.call(proc, event, handler, ...rest)
      }
    }
    const realAdd = typeof proc.addListener === 'function' ? proc.addListener.bind(proc) : undefined
    if (realAdd) {
      proc.addListener = function (this: unknown, event: string, handler: any, ...rest: any[]) {
        if (event === 'unhandledRejection' && typeof handler === 'function') {
          captured.push(handler)
          return realAdd.call(proc, event, filter, ...rest)
        }
        return realAdd.call(proc, event, handler, ...rest)
      }
    }
    const existingUc = (typeof proc.listeners === 'function' ? proc.listeners('uncaughtException') : []) as Array<(e: unknown) => void>
    const capturedUc = [...existingUc]
    if (typeof proc.removeAllListeners === 'function') proc.removeAllListeners('uncaughtException')
    if (typeof proc.on === 'function') {
      proc.on('uncaughtException', (err: unknown) => {
        if (isImRelated(err)) {
          console.error(
            '[im-gateway] 已吞掉未捕获异常（不影响桌面端）:',
            err instanceof Error ? err.message : String(err),
          )
          return
        }
        for (const h of capturedUc) {
          try {
            h(err)
          } catch {
            /* ignore */
          }
        }
        if (capturedUc.length === 0) {
          console.error(err)
          if (typeof proc.exit === 'function') proc.exit(1)
        }
      })
    }
  } catch {
    /* 尽力而为 */
  }
}
