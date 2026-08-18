/** Sidebar geometry passed by the desktop root slot. */
export interface DesktopSidebarOwnerProps {
  /** Whether the sidebar is showing its compact rail. */
  collapsed: boolean
  /** Current rendered sidebar width. */
  width: number
}

/** Public panel transitions consumed by conversation and sidebar plugins. */
export interface DesktopLayoutService {
  /** Toggle the sidebar between wide and compact presentation. */
  toggleSidebar(): void
  /** Open the current session's details panel. */
  openDetails(): void
  /** Close the details panel. */
  closeDetails(): void
  /** Switch the desktop-owned left surface. */
  setLeftPanel(panel: DesktopLeftPanel): void
  /** Open the artifacts/code panel. */
  openArtifacts(): void
  /** Close the artifacts/code panel. */
  closeArtifacts(): void
  /** Toggle the artifacts/code panel open/closed. */
  toggleArtifacts(): void
  /** Toggle the artifacts/code panel between default and enlarged width. */
  toggleArtifactsExpanded(): void
  /** Open the embedded-IDE panel. */
  openIde(): void
  /** Close the embedded-IDE panel. */
  closeIde(): void
  /** Toggle the embedded-IDE panel open/closed. */
  toggleIde(): void
  /** Toggle the embedded-IDE panel between default and enlarged width. */
  toggleIdeExpanded(): void
}

/** Left-surface selection rendered inside the desktop-owned sidebar column. */
export type DesktopLeftPanel = 'chat' | 'marketplace' | 'skins' | 'api' | 'tools' | 'workflow'

/**
 * Engine-owned turn boundary as seen by the upstream `conversation.chat.turnTail`
 * chain owner (structural mirror of the runtime TurnLocation; the desktop does
 * not import the upstream conversation types).
 */
export interface DesktopTurnLocation {
  turn: number
  start?: unknown
  end?: unknown
  status: 'open' | 'closed' | 'unknown'
  steps: readonly unknown[]
  data: unknown
}

/** Owner currency of the upstream turn-tail chain slot. */
export interface DesktopTurnTailOwner {
  /** Engine-owned closing Turn boundary. */
  turn: DesktopTurnLocation
  /** The closing assistant's seq — the anchor the tail renders under. */
  seq: number
  /** Open a filesystem path through the Host. */
  openFile: (path: string) => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Desktop-owned layout service in advanced mode. */
    layout: DesktopLayoutService
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Upstream sidebar hosted by the desktop advanced frame. */
    'sidebar': { kind: 'single'; scope: 'root'; owner: DesktopSidebarOwnerProps }
    /** Unchanged upstream conversation surface. */
    'conversation': { kind: 'single'; scope: 'session-maybe'; owner: Record<never, never> }
    /** Unchanged upstream details surface. */
    'details': { kind: 'single'; scope: 'session'; owner: Record<never, never> }
    /** Desktop-owned marketplace surface rendered in the left column. */
    'sidebar.marketplace': { kind: 'single'; scope: 'root'; owner: Record<never, never> }
    /** Desktop-owned skin selector surface rendered in the left column. */
    'sidebar.skins': { kind: 'single'; scope: 'root'; owner: Record<never, never> }
    /** Desktop-owned API settings surface rendered in the left column. */
    'sidebar.api': { kind: 'single'; scope: 'root'; owner: Record<never, never> }
    /** Desktop-owned external-tools surface rendered in the left column. */
    'sidebar.tools': { kind: 'single'; scope: 'root'; owner: Record<never, never> }
    /** Desktop-owned workflow manager surface rendered in the left column. */
    'sidebar.workflow': { kind: 'single'; scope: 'root'; owner: Record<never, never> }
    /** Headless observer that publishes the active session's model/provider to a shared store. */
    'desktop.model-monitor': { kind: 'single'; scope: 'session-maybe'; owner: Record<never, never> }
    /** Desktop-owned artifacts/code panel rendered in the right column. */
    'artifacts': { kind: 'single'; scope: 'session'; owner: Record<never, never> }
    /** Desktop-owned embedded-IDE (code-server) panel rendered in the right column. */
    'ide': { kind: 'single'; scope: 'root'; owner: Record<never, never> }
    /** Frame-wide additive overlays. */
    'shell.overlay': { kind: 'list'; scope: 'root' }
    /** Upstream turn-tail chain (declared by dsh-client-ui-conversation); the
     *  desktop contributes the per-reply usage footer into it. */
    'conversation.chat.turnTail': { kind: 'chain'; scope: 'session'; owner: DesktopTurnTailOwner }
  }
}
