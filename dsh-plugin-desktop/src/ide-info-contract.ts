/** Same-origin endpoint reporting the embedded-IDE status (VS Code linkage). */
export const DESKTOP_IDE_INFO_PATH = '/_dsh/desktop/ide/info'

/** Same-origin endpoint for reading and updating the IDE's allowed directory list. */
export const DESKTOP_IDE_CONFIG_PATH = '/_dsh/desktop/ide/config'

/**
 * Same-origin endpoint that asks the host to open the current workspace in the
 * user's installed VS Code (natively on Windows — no web IDE download needed).
 */
export const DESKTOP_IDE_OPEN_PATH = '/_dsh/desktop/ide/open'

/**
 * Loopback endpoint that forwards an editor selection (file + selected text +
 * language) into the live AI agent as a user message. The embedded IDE
 * (code-server) extension POSTs here; the host then injects the message into
 * the current agent's inbox and wakes it, so the agent explains or edits the
 * selected code. Scope note: this is a host-side bridge — the agent runs
 * locally, so the edit lands on the shared disk the IDE already shows.
 */
export const DESKTOP_IDE_ASK_PATH = '/_dsh/desktop/ide/ask'

/** Payload the IDE extension sends to {@link DESKTOP_IDE_ASK_PATH}. */
export interface DesktopIdeAskRequest {
  /** Absolute path of the file the selection belongs to. */
  file: string
  /** The selected source text. */
  selection: string
  /** Editor language id (e.g. 'typescript', 'python'); 'text' when unknown. */
  language: string
  /** Whether to ask the agent to explain or to modify the selection. */
  mode: 'explain' | 'modify'
  /** Optional free-form instruction for modify mode. */
  instruction?: string | null
}

/** Successful IDE info response returned by {@link DESKTOP_IDE_INFO_PATH}. */
export interface DesktopIdeInfoResponse {
  /**
   * Loopback URL of an embedded web IDE, or null. Always null in the VS Code
   * linkage mode (the editor is the user's native VS Code window, not an
   * iframe), kept for contract compatibility.
   */
  url: string | null
  /**
   * Lifecycle status for the client to choose a view:
   * `ready` — VS Code detected and the bridge extension is in place;
   * `missing` — VS Code could not be found; `error` — detected but setup failed.
   */
  status: 'ready' | 'missing' | 'error' | 'starting'
  /** Optional human-readable detail (e.g. why VS Code could not be found). */
  detail: string | undefined
  /** VS Code linkage status reported to the panel. */
  vscode: {
    /** Whether a `Code.exe` was located on this machine. */
    found: boolean
    /** Absolute path of the detected `Code.exe`, or null. */
    path: string | null
    /** Detected major version, or null when unknown. */
    version: string | null
    /** Whether the selection-bridge extension was synced into VS Code. */
    extensionReady: boolean
  }
}

/** Body of a {@link DESKTOP_IDE_CONFIG_PATH} POST request. */
export interface DesktopIdeConfigUpdate {
  /** Absolute directory to append to the allow-list, or null when omitted. */
  add?: string | null
  /** Absolute directory to remove from the allow-list, or null when omitted. */
  remove?: string | null
}

/** Body of a {@link DESKTOP_IDE_CONFIG_PATH} GET/POST response. */
export interface DesktopIdeConfigResponse {
  /** Absolute directories currently exposed to the embedded IDE. */
  allowedDirs: string[]
}
