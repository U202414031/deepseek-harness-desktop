/**
 * Shared types for the desktop "外部机器人" (External Robots) feature.
 *
 * Each platform (飞书 / 微信 / QQ) is represented by a {@link PlatformMeta}
 * (UI + credential fields) and a {@link Connector} (the live API surface). New
 * platforms can be added by extending the registry in `registry.ts`.
 */

/** Supported external platforms. Extend this union when adding a connector. */
export type PlatformId = 'feishu' | 'wechat' | 'qq'

/** Whether a connector is configured, connected, or failed. */
export type ConnStatus = 'unconfigured' | 'disconnected' | 'connected' | 'error'

/** A credential input shown in the connection form. */
export interface PlatformField {
  /** Stable key used to store the value in localStorage. */
  key: string
  /** UI label. */
  label: string
  /** Mask the input as a password field. */
  secret?: boolean
  /** Placeholder hint. */
  placeholder?: string
}

/** Static description of a platform for the UI. */
export interface PlatformMeta {
  id: PlatformId
  /** Human-facing name. */
  label: string
  /** Short tab label (rail width constrained). */
  short: string
  /** Emoji glyph for the tab/header. */
  emoji: string
  /** Accent color used for the active tab. */
  accent: string
  /** Link to the platform's developer console / docs. */
  docUrl: string
  /** Credential fields required to connect. */
  fields: PlatformField[]
  /** Whether this platform can pull recent messages. */
  supportsFetch: boolean
  /** How the message target is chosen. */
  targetMode: 'select' | 'text'
  /** Label for the target control. */
  targetLabel: string
  /** Optional sub-types of destination (e.g. group vs private). When present, the UI shows a type selector and `targetMode`/`targetLabel` act as fallbacks. */
  targetTypes?: TargetTypeOption[]
  /** Optional caveat shown under the connection form. */
  note?: string
}

/** A scheduled outgoing message persisted locally and fired at `at` (epoch ms). */
export interface ScheduleItem {
  id: string
  platform: PlatformId
  target: string
  targetType: string
  text: string
  at: number
  status: 'pending' | 'sent' | 'failed' | 'missed'
  result?: string
}

/** Persisted state of the auto-summary job for one platform. */
export interface AutoConfig {
  enabled: boolean
  /** Minutes between automatic summary runs. */
  interval: number
  /** Target the job monitors (a chat id / openid). */
  target: string
  /** Destination kind the job monitors. */
  targetType: string
}

/** One digest produced by an auto-summary run. */
export interface SummaryEntry {
  id: string
  /** Epoch ms when the run completed. */
  at: number
  /** Target the run summarized (a chat id / openid). */
  target: string
  /** Destination kind that was summarized. */
  targetType: string
  /** The generated summary text. */
  text: string
}

/** A selectable message destination (chat / group / user). */
export interface PlatformTarget {
  id: string
  name: string
}

/** A kind of message destination a platform supports (e.g. group vs private chat). */
export interface TargetTypeOption {
  id: string
  label: string
  /** How the destination value is entered for this type. */
  input: 'select' | 'text'
  /** Placeholder for the text-input variant. */
  placeholder?: string
}

/** A normalized inbound message. */
export interface PlatformMessage {
  id: string
  sender: string
  text: string
  /** Display time string (already formatted by the connector). */
  time: string
}

/** Outcome of a send attempt. */
export interface SendResult {
  ok: boolean
  message: string
}

/** A locally-stored task created from the tools panel. */
export interface ToolTask {
  id: string
  title: string
  detail?: string
  done: boolean
  createdAt: number
  /** Platform the task was created from. */
  source: PlatformId
}

/**
 * Live API surface for one platform. Implementations must tolerate missing or
 * invalid credentials and surface friendly errors rather than throwing raw
 * network exceptions to the UI.
 */
export interface Connector {
  meta: PlatformMeta
  /** Exchange credentials for a session token; throws a friendly Error on failure. */
  connect(values: Record<string, string>): Promise<string>
  /** Send `text` to `target`; never throws (returns a {@link SendResult}). `opts.targetType` selects the destination kind. */
  sendMessage(token: string, target: string, text: string, opts?: { targetType?: string }): Promise<SendResult>
  /** List available message targets. Only called when the active target type's input is 'select'. */
  listTargets(token: string): Promise<PlatformTarget[]>
  /** Pull recent messages for `target`. Only called when {@link PlatformMeta.supportsFetch} is true. `opts.targetType` selects the destination kind. */
  fetchMessages(token: string, target: string, opts?: { targetType?: string }): Promise<PlatformMessage[]>
}
