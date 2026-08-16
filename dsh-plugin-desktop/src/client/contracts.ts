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
}

/** Left-surface selection rendered inside the desktop-owned sidebar column. */
export type DesktopLeftPanel = 'chat' | 'marketplace' | 'skins' | 'api' | 'tools'

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
    /** Headless observer that publishes the active session's model/provider to a shared store. */
    'desktop.model-monitor': { kind: 'single'; scope: 'session-maybe'; owner: Record<never, never> }
    /** Desktop-owned artifacts/code panel rendered in the right column. */
    'artifacts': { kind: 'single'; scope: 'session'; owner: Record<never, never> }
    /** Frame-wide additive overlays. */
    'shell.overlay': { kind: 'list'; scope: 'root' }
  }
}
