/**
 * Unified IM gateway core.
 *
 * Owns the per-platform channel adapters and the mapping between an IM
 * conversation and a DeepSeek Harness session. Inbound messages are routed here
 * (via {@link ImGatewayContext.handleInbound}); a normal message is forwarded to
 * the harness agent and the streaming reply is sent back, while slash commands
 * (`/status`, `/deploy`, …) offer phone-friendly control.
 */

import type {
  HarnessBridge,
  ImChannelAdapter,
  ImChannelConfig,
  ImChannelStatus,
  ImGatewayContext,
  ImGatewaySettings,
  ImInboundMessage,
} from './types.ts'

/** Factory that builds a channel adapter for a given config. */
export type ChannelFactory = (
  config: ImChannelConfig,
  gateway: ImGatewayContext,
) => ImChannelAdapter

const SLASH_HELP = [
  '🤖 DeepSeek IM 网关命令：',
  '/status — 查看工作状态与会话列表',
  '/deploy <任务> — 让 deepseek 执行一个部署/任务',
  '/new — 开启一个全新会话',
  '/stop — 停止当前回复',
  '/model — 查看当前模型',
  '/help — 显示本帮助',
].join('\n')

export class ImGateway implements ImGatewayContext {
  private readonly adapters = new Map<string, ImChannelAdapter>()
  private readonly factories = new Map<string, ChannelFactory>()
  private readonly sessions = new Map<string, string>()
  /** channel.id -> 连接该通道时的配置指纹；用于 reload 时判断「配置没变 → 复用已有适配器」。 */
  private readonly connectKeys = new Map<string, string>()

  constructor(
    private readonly getSettings: () => ImGatewaySettings,
    readonly harness: HarnessBridge,
    private readonly onChange?: () => void,
  ) {}

  /** Register a channel adapter factory for a platform type. */
  register(type: string, factory: ChannelFactory): void {
    this.factories.set(type, factory)
  }

  /** Connect all enabled channels and begin delivering inbound messages. */
  async start(): Promise<void> {
    await this.reload()
  }

  /** Disconnect everything and reconnect from the current settings. */
  async reload(): Promise<void> {
    const settings = this.getSettings()
    const next = new Map<string, ImChannelAdapter>()
    const seen = new Set<string>()
    const seenTypes = new Set<string>()
    for (const channel of settings.channels) {
      if (!channel.enabled) continue
      const factory = this.factories.get(channel.type)
      if (!factory) continue
      seen.add(channel.id)
      // 同一平台只允许一个客户端（QQ 官方机器人只有一个 WebSocket 网关实例，
      // 多个实例用同一 QQ 会互相踢下线、互相覆盖二维码文件，表现为「扫码没反应」）。
      if (seenTypes.has(channel.type)) {
        console.warn(`[im-gateway] 已存在同类型通道 ${channel.type}，跳过重复通道 ${channel.id}（请只保留一个）`)
        continue
      }
      seenTypes.add(channel.type)
      const existing = this.adapters.get(channel.id)
      const key = this.configKey(channel)
      // 配置未变 + 已有适配器 → 复用，避免反复新建 WebSocket 连接。
      if (existing && this.connectKeys.get(channel.id) === key) {
        next.set(channel.id, existing)
        continue
      }
      try {
        if (existing) {
          try {
            existing.disconnect()
          } catch {
            /* ignore */
          }
          this.connectKeys.delete(channel.id)
        }
        const adapter = factory(channel, this)
        await adapter.connect(channel, this)
        next.set(channel.id, adapter)
        this.connectKeys.set(channel.id, key)
      } catch (cause) {
        // Connection failure is recorded in status; keep booting other channels.
        console.error(`[im-gateway] channel ${channel.id} failed to connect:`, cause)
      }
    }
    // 断开已被移除或禁用的旧通道。
    for (const [id, adapter] of this.adapters) {
      if (!seen.has(id)) {
        try {
          adapter.disconnect()
        } catch {
          /* ignore */
        }
        this.connectKeys.delete(id)
      }
    }
    this.adapters.clear()
    for (const [id, adapter] of next) this.adapters.set(id, adapter)
    this.onChange?.()
  }

  /** 通道的配置指纹：类型 + 全部配置项，用于判断是否需要重建连接。 */
  private configKey(channel: ImChannelConfig): string {
    return `${channel.type}|${JSON.stringify(channel.config ?? {})}`
  }

  /** Snapshot of every configured channel's connection state. */
  status(): ImChannelStatus[] {
    const settings = this.getSettings()
    const out: ImChannelStatus[] = []
    for (const channel of settings.channels) {
      const adapter = this.adapters.get(channel.id)
      out.push(
        adapter
          ? adapter.getStatus()
          : {
              type: channel.type,
              id: channel.id,
              name: channel.name,
              enabled: channel.enabled,
              connected: false,
            },
      )
    }
    return out
  }

  /** Expose an adapter for management routes (e.g. QR login). */
  getAdapter(id: string): ImChannelAdapter | undefined {
    return this.adapters.get(id)
  }

  /** Tear down every connected channel without reconnecting. */
  dispose(): void {
    for (const adapter of this.adapters.values()) {
      try {
        adapter.disconnect()
      } catch {
        /* ignore */
      }
    }
    this.adapters.clear()
  }

  /** Entry point called by every channel adapter for each inbound message. */
  async handleInbound(message: ImInboundMessage): Promise<void> {
    const adapter = this.adapters.get(message.channelId)
    if (!adapter) return
    const text = message.text.trim()
    if (text.startsWith('/')) {
      await this.handleSlash(message, adapter, text.slice(1).trim())
      return
    }
    await this.streamReply(message, adapter, text)
  }

  private async streamReply(
    message: ImInboundMessage,
    adapter: ImChannelAdapter,
    text: string,
  ): Promise<void> {
    const sessionId = await this.ensureSession(message)
    const stream = adapter.beginStream(message.conversationId)
    try {
      await this.harness.prompt(sessionId, text, {
        onChunk: (chunk) => stream.streamText(chunk),
        onEnd: () => stream.end(),
        onError: (error) => stream.fail(error),
      })
    } catch (cause) {
      stream.fail(cause instanceof Error ? cause.message : String(cause))
    }
  }

  private async ensureSession(message: ImInboundMessage): Promise<string> {
    const key = `${message.channel}:${message.conversationId}`
    const existing = this.sessions.get(key)
    if (existing) return existing
    const id = await this.harness.createSession()
    this.sessions.set(key, id)
    return id
  }

  private async handleSlash(
    message: ImInboundMessage,
    adapter: ImChannelAdapter,
    raw: string,
  ): Promise<void> {
    const [name, ...rest] = raw.split(/\s+/)
    const arg = rest.join(' ').trim()
    const stream = adapter.beginStream(message.conversationId)
    switch (name) {
      case 'help':
        stream.streamText(SLASH_HELP)
        stream.end()
        return
      case 'status': {
        try {
          const [status, sessions] = await Promise.all([
            this.harness.getStatus(),
            this.harness.listSessions(),
          ])
          const lines = [
            '📊 DeepSeek 工作状态',
            `版本: ${status.version}`,
            `工作目录: ${status.cwd}`,
            `模型: ${status.model ?? '未知'}`,
            `在线会话: ${status.attachedSessions}`,
            '',
            `会话列表 (${sessions.length}):`,
            ...sessions
              .slice(0, 10)
              .map((s, i) => `  ${i + 1}. ${s.title ?? s.sessionId}${s.running ? ' 🟢运行中' : ''}`),
          ]
          stream.streamText(lines.join('\n'))
          stream.end()
        } catch (cause) {
          stream.fail(cause instanceof Error ? cause.message : String(cause))
        }
        return
      }
      case 'new': {
        this.sessions.delete(`${message.channel}:${message.conversationId}`)
        stream.streamText('已开始全新会话。')
        stream.end()
        return
      }
      case 'stop': {
        const sid = this.sessions.get(`${message.channel}:${message.conversationId}`)
        if (sid) await this.harness.cancel(sid)
        stream.streamText('已请求停止当前回复。')
        stream.end()
        return
      }
      case 'model': {
        const status = await this.harness.getStatus()
        stream.streamText(`当前模型: ${status.model ?? '未知'}`)
        stream.end()
        return
      }
      case 'deploy': {
        const task = arg.length > 0 ? arg : '执行默认部署任务'
        const sessionId = await this.ensureSession(message)
        await this.harness.prompt(sessionId, `请执行以下部署任务：${task}`, {
          onChunk: (chunk) => stream.streamText(chunk),
          onEnd: () => stream.end(),
          onError: (error) => stream.fail(error),
        })
        return
      }
      default:
        stream.streamText(`未知命令：/${name}\n${SLASH_HELP}`)
        stream.end()
    }
  }
}
