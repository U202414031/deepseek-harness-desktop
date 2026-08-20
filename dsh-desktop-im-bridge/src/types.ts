/**
 * Shared types for the in-app IM gateway.
 *
 * The gateway runs in the **host process** (same Cordis root as the DeepSeek
 * Harness engine) and bridges instant-messaging platforms (QQ / 飞书 / 微信) to
 * the local harness agent, so a user can query work status and dispatch tasks
 * from their phone. This mirrors the architecture of `dsh-im-gateway` /
 * `dsh-cc-connect`: a unified core + one adapter per platform.
 */

/** Supported IM platforms. Extend the union when adding an adapter. */
export type ImChannelType = 'qq' | 'feishu' | 'weixin'

/** Persisted configuration for a single channel instance. */
export interface ImChannelConfig {
  /** Stable unique id (may differ from `type` when multiple bots of one type exist). */
  id: string
  type: ImChannelType
  /** Human-facing label shown in the UI. */
  name: string
  /** Whether the gateway should connect this channel on startup. */
  enabled: boolean
  /** Channel-specific credentials / settings (app id, secret, tokens, …). */
  config: Record<string, string>
}

/** Top-level persisted gateway settings. */
export interface ImGatewaySettings {
  channels: ImChannelConfig[]
}

/** A normalized inbound message from any platform. */
export interface ImInboundMessage {
  channel: ImChannelType
  /** Channel instance id (matches {@link ImChannelConfig.id}). */
  channelId: string
  /** Stable per-chat id (group id or user openid). */
  conversationId: string
  senderId: string
  senderName: string
  text: string
  /** Original platform-specific payload, for debugging. */
  raw?: unknown
}

/** Streaming reply sink for one outbound message to a conversation. */
export interface ImOutboundStream {
  /** Append a chunk of text to the reply (called repeatedly). */
  streamText(text: string): void
  /** Finalize the reply successfully. */
  end(): void
  /** Finalize the reply with an error. */
  fail(error: string): void
}

/** Connection status of one channel instance. */
export interface ImChannelStatus {
  type: ImChannelType
  id: string
  name: string
  enabled: boolean
  connected: boolean
  /** Free-form detail / error message. */
  detail?: string
}

/** Minimal summary of a harness session. */
export interface HarnessSessionInfo {
  sessionId: string
  title?: string
  running: boolean
  cwd?: string
}

/** One selectable option of an agent question (mirrors `AskUserQuestionOption`). */
export interface ImQuestionOption {
  /** User-facing label — the value echoed back in the answer. */
  label: string
  /** Optional extra context for capable UIs. */
  description?: string
}

/** One question the agent asked (mirrors `AskUserQuestionItem`). */
export interface ImQuestion {
  /** Stable question id, echoed in the answer. */
  id: string
  /** The question to display. */
  question: string
  /** Optional supporting detail. */
  detail?: string
  /** Optional short heading/group label. */
  header?: string
  /** Optional choices; when absent the user answers with free text. */
  options?: ImQuestionOption[]
  /** Whether more than one option may be selected. Defaults to single-select. */
  multiSelect?: boolean
}

/** A `question/requested` frame delivered over the events mux. */
export interface ImQuestionRequest {
  /** Stable rpc id minted by the host — must be echoed when answering. */
  rpcId: string
  sessionId: string
  questions: ImQuestion[]
}

/** Answer to a single question (label-based; see `selected` semantics). */
export interface ImQuestionAnswerItem {
  id: string
  /** Selected option labels (labels, not indices). */
  selected: string[]
  /** Optional free-text answer when the question has no options. */
  custom?: string
}

/** Outcome of submitting an answer to the host. */
export interface QuestionAnswerResult {
  accepted: boolean
  reason?: string
}

/** Snapshot of the host / agent status. */
export interface HostStatus {
  version: string
  cwd: string
  provider?: string
  model?: string
  attachedSessions: number
  canOpenPath: boolean
}

/** Callbacks for a streaming agent turn. */
export interface PromptHandlers {
  onChunk(text: string): void
  onTool?(name: string, args: unknown): void
  /**
   * The agent asked the human a question (user-questions domain). Called with
   * the full request; the handler MUST eventually resolve (after the human
   * answers or a fallback kicks in) or the agent turn stays blocked.
   */
  onQuestion?(request: ImQuestionRequest): void | Promise<void>
  onEnd(reason: string): void
  onError(error: string): void
}

/** The harness bridge the gateway depends on (implemented by {@link HarnessClient}). */
export interface HarnessBridge {
  listSessions(): Promise<HarnessSessionInfo[]>
  getStatus(): Promise<HostStatus>
  createSession(opts?: { cwd?: string; agentPreset?: string }): Promise<string>
  cancel(sessionId: string): Promise<void>
  prompt(sessionId: string, text: string, handlers: PromptHandlers): Promise<void>
  /** Submit the human's answer for a pending question. */
  answerQuestion(
    request: ImQuestionRequest,
    answers: ImQuestionAnswerItem[],
  ): Promise<QuestionAnswerResult>
  /** Abort a pending question (the agent turn continues without an answer). */
  cancelQuestion(request: ImQuestionRequest): Promise<void>
}

/** Context handed to each channel adapter so it can reach the gateway core. */
export interface ImGatewayContext {
  harness: HarnessBridge
  handleInbound(message: ImInboundMessage): Promise<void>
}

/**
 * Live API surface for one IM platform. Implementations must tolerate missing
 * or invalid credentials and surface friendly errors rather than throwing raw
 * network exceptions into the gateway.
 */
export interface ImChannelAdapter {
  readonly type: ImChannelType
  /** Open the connection and start delivering inbound messages via `gateway.handleInbound`. */
  connect(config: ImChannelConfig, gateway: ImGatewayContext): Promise<void>
  /** Tear down the connection and release resources. */
  disconnect(): void
  /** Send a one-shot text message (used for notifications / status replies). */
  sendText(conversationId: string, text: string): Promise<void>
  /** Begin a streaming reply (preferred for agent responses). */
  beginStream(conversationId: string): ImOutboundStream
  /** Snapshot of the current connection state. */
  getStatus(): ImChannelStatus
  /** Optional QR-code login; returns an image the user scans on their phone. */
  qrLogin?(): Promise<{ qrCodeUrl: string; tip?: string }>
}
