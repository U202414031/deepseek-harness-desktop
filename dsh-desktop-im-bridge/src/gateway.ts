/**
 * Unified IM gateway core.
 *
 * Owns the per-platform channel adapters and the mapping between an IM
 * conversation and a DeepSeek Harness session. Inbound messages are routed here
 * (via {@link ImGatewayContext.handleInbound}); a normal message is forwarded to
 * the harness agent and the streaming reply is sent back, while slash commands
 * (`/status`, `/deploy`, …) offer phone-friendly control.
 *
 * Phone-first task dispatch:
 *   - `在 <目录> 执行 <任务>` (and a few synonym verbs) pins the task to a
 *     specific working directory by creating a session bound to that `cwd`.
 *   - When the agent asks the human a question (`ask_user_question`), the
 *     question is forwarded to the IM conversation with numbered options, the
 *     user's reply is collected, and the answer is submitted back to the
 *     harness — with a timeout fallback so a missing reply never stalls the
 *     turn forever.
 */

import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  HarnessBridge,
  ImChannelAdapter,
  ImChannelConfig,
  ImChannelStatus,
  ImGatewayContext,
  ImGatewaySettings,
  ImInboundMessage,
  ImQuestionAnswerItem,
  ImQuestionRequest,
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
  '',
  '💡 在指定目录执行任务：发送「在 <目录> 执行 <任务>」，',
  '例如：在 D:\\WorkBuddy\\deepseek-desk 执行 修复 README 里的错别字',
].join('\n')

/** 「在 <目录> 执行 <任务>」自然语言前缀（路径以「执行/运行/处理/做/帮我」等动词分隔）。 */
const WORKDIR_PATTERN = /^在\s+(.+?)\s+(?:执行|运行|处理|做|帮我|帮我做|帮我完成)\s+([\s\S]+)$/

/** 用户回答提问的默认等待时长（毫秒）。超时后自动兜底，避免任务卡死。 */
const QUESTION_TIMEOUT_MS = 180_000

/**
 * Parse an inbound text into (optional pinned cwd, task text).
 * When no valid workdir prefix is present the whole text is the task.
 */
export function parseWorkdirTask(text: string): { cwd?: string; task: string } {
  const match = WORKDIR_PATTERN.exec(text)
  if (!match) return { task: text }
  const cwd = resolveWorkdir(match[1]!)
  if (!cwd) return { task: text }
  const task = match[2]!.trim()
  return task ? { cwd, task } : { task: text }
}

/** Expand `~` and validate that the raw path is an existing directory. */
export function resolveWorkdir(raw: string): string | undefined {
  const dir = raw
    .trim()
    .replace(/^["'`]/, '')
    .replace(/["'`]$/, '')
    .trim()
  if (!dir) return undefined
  const expanded = dir.startsWith('~') ? join(homedir(), dir.slice(1)) : dir
  try {
    if (existsSync(expanded) && statSync(expanded).isDirectory()) return expanded
  } catch {
    /* fall through */
  }
  return undefined
}

/** Map a reply like `1` / `1,3` / `1，3` to option indices (0-based). */
export function parseOptionIndices(
  text: string,
  count: number,
  multiSelect: boolean | undefined,
): number[] | undefined {
  const parts = text
    .split(/[,，、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const indices: number[] = []
  for (const part of parts) {
    const n = Number(part)
    if (!Number.isInteger(n) || n < 1 || n > count) return undefined
    const zero = n - 1
    if (indices.includes(zero)) return undefined
    indices.push(zero)
  }
  if (indices.length === 0) return undefined
  if (multiSelect !== true && indices.length > 1) return undefined
  return indices
}

/** One question being answered interactively over an IM conversation. */
interface PendingAsk {
  key: string
  request: ImQuestionRequest
  adapter: ImChannelAdapter
  conversationId: string
  /** Index of the question currently waiting for a reply. */
  current: number
  /** Answers collected so far, in question order. */
  answers: ImQuestionAnswerItem[]
  timer: ReturnType<typeof setTimeout> | undefined
  resolve: () => void
  reject: (error: Error) => void
  settled: boolean
}

export class ImGateway implements ImGatewayContext {
  private readonly adapters = new Map<string, ImChannelAdapter>()
  private readonly factories = new Map<string, ChannelFactory>()
  private readonly sessions = new Map<string, string>()
  /** conversationKey -> cwd the bound session was created with (undefined = host default). */
  private readonly sessionCwds = new Map<string, string>()
  /** conversationKey -> question currently awaiting a reply over IM. */
  private readonly pendingAsks = new Map<string, PendingAsk>()
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
        // 单个通道的连接加超时保护：网络挂起时不能拖死整个保存/重连流程
        //（否则 UI 的 busy 永远卡 true，表现为「按钮点不动」）。
        await Promise.race([
          adapter.connect(channel, this),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`连接超时（${channel.name}）`)), 20_000),
          ),
        ])
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
    // 终止所有等待中的提问（取消并放行，避免 agent 永久阻塞）。
    for (const ask of this.pendingAsks.values()) {
      clearTimeout(ask.timer)
      if (!ask.settled) {
        ask.settled = true
        void this.harness.cancelQuestion(ask.request)
        ask.resolve()
      }
    }
    this.pendingAsks.clear()
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
    // 正在等待用户回答提问 → 本条消息视为回答。
    const ask = this.pendingAsks.get(`${message.channel}:${message.conversationId}`)
    if (ask) {
      await this.handleQuestionReply(ask, text)
      return
    }
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
    const { cwd, task } = parseWorkdirTask(text)
    const sessionId = await this.ensureSession(message, cwd)
    const stream = adapter.beginStream(message.conversationId)
    try {
      await this.harness.prompt(sessionId, task, {
        onChunk: (chunk) => stream.streamText(chunk),
        onQuestion: async (request) => {
          await this.askOnIm(adapter, message, request)
        },
        onEnd: () => stream.end(),
        onError: (error) => stream.fail(error),
      })
    } catch (cause) {
      stream.fail(cause instanceof Error ? cause.message : String(cause))
    }
  }

  private async ensureSession(message: ImInboundMessage, cwd?: string): Promise<string> {
    const key = `${message.channel}:${message.conversationId}`
    const existing = this.sessions.get(key)
    if (existing) {
      const current = this.sessionCwds.get(key)
      // 指定了不同的目录 → 开启绑定新目录的会话（旧会话保留在 harness，不再关联）。
      if (!cwd || current === cwd) return existing
      this.sessions.delete(key)
      this.sessionCwds.delete(key)
    }
    const id = await this.harness.createSession(cwd ? { cwd } : undefined)
    this.sessions.set(key, id)
    if (cwd) this.sessionCwds.set(key, cwd)
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
          const key = `${message.channel}:${message.conversationId}`
          const cwd = this.sessionCwds.get(key) ?? status.cwd
          const lines = [
            '📊 DeepSeek 工作状态',
            `版本: ${status.version}`,
            `工作目录: ${cwd}`,
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
        const key = `${message.channel}:${message.conversationId}`
        this.sessions.delete(key)
        this.sessionCwds.delete(key)
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
          onQuestion: async (request) => {
            await this.askOnIm(adapter, message, request)
          },
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

  // ---- interactive questions (ask_user_question over IM) ----

  /**
   * Forward a harness question to the IM conversation, collect the user's
   * reply (numbered options or free text), submit the answers, and only then
   * resolve — the agent turn stays blocked until then. Never rejects: every
   * failure path cancels the question so the turn cannot stall forever.
   */
  private async askOnIm(
    adapter: ImChannelAdapter,
    message: ImInboundMessage,
    request: ImQuestionRequest,
  ): Promise<void> {
    const key = `${message.channel}:${message.conversationId}`
    const previous = this.pendingAsks.get(key)
    if (previous) {
      // 防御：同会话重复提问时先取消旧的。
      clearTimeout(previous.timer)
      previous.settled = true
      previous.resolve()
      void this.harness.cancelQuestion(previous.request)
    }
    const ask: PendingAsk = {
      key,
      request,
      adapter,
      conversationId: message.conversationId,
      current: 0,
      answers: [],
      timer: undefined,
      resolve: () => {},
      reject: () => {},
      settled: false,
    }
    this.pendingAsks.set(key, ask)
    try {
      await this.askNext(ask)
    } catch (cause) {
      this.abortAsk(ask, cause)
      return
    }
    await new Promise<void>((resolve, reject) => {
      ask.resolve = resolve
      ask.reject = reject
    })
  }

  /** Send the current question of `ask` to the conversation and arm the timeout. */
  private async askNext(ask: PendingAsk): Promise<void> {
    // ask.current is always < questions.length while a PendingAsk is active.
    const q = ask.request.questions[ask.current]!
    const lines: string[] = []
    if (q.header) lines.push(`【${q.header}】`)
    lines.push(q.question)
    if (q.detail) lines.push(q.detail)
    if (q.options && q.options.length > 0) {
      q.options.forEach((o, i) =>
        lines.push(`${i + 1}. ${o.label}${o.description ? `（${o.description}）` : ''}`),
      )
      lines.push(
        `（回复编号${q.multiSelect ? '，多个用逗号分隔（如 1,3）' : ''}；回复「取消」放弃）`,
      )
    } else {
      lines.push('（请直接回复你的答案；回复「取消」放弃）')
    }
    await ask.adapter.sendText(ask.conversationId, lines.join('\n'))
    clearTimeout(ask.timer)
    ask.timer = setTimeout(() => void this.askTimeout(ask), QUESTION_TIMEOUT_MS)
  }

  /** Handle the user's reply to the currently pending question. */
  private async handleQuestionReply(ask: PendingAsk, text: string): Promise<void> {
    if (ask.settled) return
    const q = ask.request.questions[ask.current]!
    if (text === '取消' || text === 'cancel' || text === '算了' || text === '跳过') {
      clearTimeout(ask.timer)
      this.pendingAsks.delete(ask.key)
      ask.settled = true
      void this.harness.cancelQuestion(ask.request)
      await ask.adapter.sendText(ask.conversationId, '已取消该问题。').catch(() => {})
      ask.resolve()
      return
    }
    if (q.options && q.options.length > 0) {
      const indices = parseOptionIndices(text, q.options.length, q.multiSelect)
      if (indices === undefined) {
        await ask.adapter
          .sendText(
            ask.conversationId,
            `请回复选项编号（如 1）${q.multiSelect ? '，多个用逗号分隔（如 1,3）' : ''}，或回复「取消」。`,
          )
          .catch(() => {})
        return
      }
      ask.answers.push({ id: q.id, selected: indices.map((i) => q.options![i]!.label) })
    } else {
      const custom = text.trim()
      ask.answers.push({ id: q.id, selected: [], ...(custom ? { custom } : {}) })
    }
    ask.current += 1
    if (ask.current < ask.request.questions.length) {
      await this.askNext(ask)
      return
    }
    // 所有问题已回答 → 提交给 harness。
    clearTimeout(ask.timer)
    this.pendingAsks.delete(ask.key)
    ask.settled = true
    const result = await this.harness.answerQuestion(ask.request, ask.answers)
    if (!result.accepted) {
      await ask.adapter
        .sendText(
          ask.conversationId,
          `⚠️ 答案提交失败：${result.reason ?? '未知原因'}（agent 可能已结束该轮）`,
        )
        .catch(() => {})
    }
    ask.resolve()
  }

  /** Timeout fallback: pick the first option when possible, otherwise cancel. */
  private async askTimeout(ask: PendingAsk): Promise<void> {
    if (ask.settled) return
    const q = ask.request.questions[ask.current]!
    let note: string
    if (q.options && q.options.length > 0 && q.multiSelect !== true) {
      ask.answers.push({ id: q.id, selected: [q.options[0]!.label] })
      note = `⚠️ 等待超时，已自动选择「${q.options[0]!.label}」。`
    } else {
      this.pendingAsks.delete(ask.key)
      ask.settled = true
      void this.harness.cancelQuestion(ask.request)
      await ask.adapter.sendText(ask.conversationId, '⚠️ 等待超时，已取消该问题。').catch(() => {})
      ask.resolve()
      return
    }
    ask.current += 1
    if (ask.current < ask.request.questions.length) {
      await this.askNext(ask)
      await ask.adapter.sendText(ask.conversationId, note).catch(() => {})
      return
    }
    this.pendingAsks.delete(ask.key)
    ask.settled = true
    const result = await this.harness.answerQuestion(ask.request, ask.answers)
    if (!result.accepted) {
      note += `\n⚠️ 答案提交失败：${result.reason ?? '未知原因'}`
    }
    await ask.adapter.sendText(ask.conversationId, note).catch(() => {})
    ask.resolve()
  }

  /** Cancel a pending ask and notify the user (used for unexpected failures). */
  private abortAsk(ask: PendingAsk, cause: unknown): void {
    clearTimeout(ask.timer)
    this.pendingAsks.delete(ask.key)
    ask.settled = true
    void this.harness.cancelQuestion(ask.request)
    void ask.adapter
      .sendText(
        ask.conversationId,
        `⚠️ 提问流程异常：${cause instanceof Error ? cause.message : String(cause)}`,
      )
      .catch(() => {})
    ask.resolve()
  }
}
