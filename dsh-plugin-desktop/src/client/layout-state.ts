/** Advanced-shell panel state shared by the root slot and layout-service adapter. */
export interface DesktopLayoutSnapshot {
  /** Preferred sidebar width; zero means the compact rail. */
  sidebar: number
  /** Preferred details width; zero means closed. */
  details: number
  /** Preferred artifacts/code panel width; zero means closed. */
  artifacts: number
  /** Whether the artifacts/code panel is currently in its enlarged width. */
  artifactsExpanded: boolean
  /** Preferred embedded-IDE panel width; zero means closed. */
  ide: number
  /** Whether the embedded-IDE panel is currently in its enlarged width. */
  ideExpanded: boolean
  /** Whether the current viewport is below the automatic-collapse breakpoint. */
  narrow: boolean
  /** Manual narrow-screen override that temporarily expands the rail. */
  narrowExpanded: boolean
  /** Active left-surface selection driving the sidebar column content. */
  leftPanel: DesktopLeftPanel
}

/** Left-surface selection rendered inside the desktop-owned sidebar column. */
export type DesktopLeftPanel = 'chat' | 'marketplace' | 'skins' | 'api' | 'tools' | 'workflow'

/** Column geometry after preserving the center surface. */
export interface DesktopColumns {
  /** Rendered sidebar width. */
  sidebar: number
  /** Rendered center width. */
  center: number
  /** Rendered details width. */
  details: number
  /** Rendered artifacts/code panel width. */
  artifacts: number
  /** Rendered embedded-IDE panel width. */
  ide: number
}

/** Compatibility-mode compact rail used by the upstream Windows sidebar. */
export const SIDEBAR_COLLAPSED = 56
/** Wider compact rail reserved for the desktop-owned macOS sidebar. */
export const MACOS_SIDEBAR_COLLAPSED = 90
export const SIDEBAR_DEFAULT = 280
export const SIDEBAR_MIN = 264
export const SIDEBAR_MAX = 420
export const SIDEBAR_AUTO_COLLAPSE = 1024
export const DETAILS_DEFAULT = 360
export const DETAILS_MIN = 300
export const DETAILS_MAX = 520
export const ARTIFACTS_DEFAULT = 360
export const ARTIFACTS_MIN = 300
export const ARTIFACTS_MAX = 560
/** Reserved width of the always-present right-edge control rail, mirroring the sidebar rail. */
export const ARTIFACTS_RAIL = 56
export const IDE_DEFAULT = 420
export const IDE_MIN = 320
export const IDE_MAX = 720
/** Reserved width of the always-present right-edge control rail for the IDE panel. */
export const IDE_RAIL = 56
export const CENTER_MIN = 640

/**
 * Resolve five desktop columns without allowing details, artifacts, or the IDE
 * panel to squeeze the conversation below its floor.
 * @param viewport - available frame width.
 * @param sidebar - sidebar preference, where zero selects the compact rail.
 * @param details - details preference, where zero closes the panel.
 * @param collapsedWidth - rail width used when the sidebar preference is zero.
 * @param artifacts - artifacts/code panel preference, where zero closes it.
 * @param artifactsExpanded - whether the artifacts panel is enlarged to full width.
 * @param ide - embedded-IDE panel preference, where zero closes it.
 * @param ideExpanded - whether the IDE panel is enlarged to full width.
 * @returns rendered column widths.
 */
export function computeDesktopColumns(
  viewport: number,
  sidebar: number,
  details: number,
  collapsedWidth: number = SIDEBAR_COLLAPSED,
  artifacts: number = 0,
  artifactsExpanded: boolean = false,
  ide: number = 0,
  ideExpanded: boolean = false,
): DesktopColumns {
  const sidebarWidth = sidebar === 0 ? collapsedWidth : clamp(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const preferredDetails = details === 0 ? 0 : clamp(details, DETAILS_MIN, DETAILS_MAX)
  const artifactsOpen = artifacts > 0
  // Always reserve the rail so the right-edge reopen affordance stays visible,
  // mirroring the left sidebar's persistent collapsed rail. A closed panel shows
  // only the rail; an open panel shows its content.
  const preferredArtifacts = artifactsOpen ? clamp(artifacts, ARTIFACTS_MIN, ARTIFACTS_MAX) : ARTIFACTS_RAIL
  const ideOpen = ide > 0
  const preferredIde = ideOpen ? clamp(ide, IDE_MIN, IDE_MAX) : IDE_RAIL

  // Enlarged state: one right panel takes the whole window (minus the left
  // sidebar, the optional details column, and the other panel's rail), collapsing
  // the conversation to a sliver — matching the maximize action for right panels.
  if ((artifactsOpen && artifactsExpanded) || (ideOpen && ideExpanded)) {
    const expandIde = ideOpen && ideExpanded
    const otherRail = expandIde ? preferredArtifacts : preferredIde
    const expanded = Math.max(IDE_MIN, viewport - sidebarWidth - preferredDetails - otherRail)
    return {
      sidebar: sidebarWidth,
      center: Math.max(0, viewport - sidebarWidth - preferredDetails - otherRail - expanded),
      details: preferredDetails,
      artifacts: expandIde ? preferredArtifacts : expanded,
      ide: expandIde ? expanded : preferredIde,
    }
  }
  // Fits with the requested widths: render both right docked panels.
  if (sidebarWidth + preferredDetails + preferredArtifacts + preferredIde + CENTER_MIN <= viewport) {
    return {
      sidebar: sidebarWidth,
      center: viewport - sidebarWidth - preferredDetails - preferredArtifacts - preferredIde,
      details: preferredDetails,
      artifacts: preferredArtifacts,
      ide: preferredIde,
    }
  }
  // A right panel is explicitly open but everything no longer fits: keep each
  // open panel at its minimum and let the conversation shrink below its floor.
  const minArtifacts = artifactsOpen ? ARTIFACTS_MIN : ARTIFACTS_RAIL
  const minIde = ideOpen ? IDE_MIN : IDE_RAIL
  const minCenter = Math.max(360, viewport - sidebarWidth - preferredDetails - minArtifacts - minIde)
  if (minCenter >= 360) {
    return { sidebar: sidebarWidth, center: minCenter, details: preferredDetails, artifacts: minArtifacts, ide: minIde }
  }
  // Cannot open both content panels; keep their rails visible so reopen works.
  const railArtifacts = ARTIFACTS_RAIL
  const railIde = IDE_RAIL
  const centerForRails = Math.max(360, viewport - sidebarWidth - preferredDetails - railArtifacts - railIde)
  return { sidebar: sidebarWidth, center: centerForRails, details: preferredDetails, artifacts: railArtifacts, ide: railIde }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Small observable panel controller used by the advanced root registration. */
export class DesktopLayoutState {
  private snapshot: DesktopLayoutSnapshot = Object.freeze({
    sidebar: SIDEBAR_DEFAULT,
    details: 0,
    artifacts: ARTIFACTS_DEFAULT,
    artifactsExpanded: false,
    ide: 0,
    ideExpanded: false,
    narrow: false,
    narrowExpanded: false,
    leftPanel: 'chat',
  })
  private readonly listeners = new Set<() => void>()

  /** @returns the immutable current panel snapshot. */
  getSnapshot(): DesktopLayoutSnapshot {
    return this.snapshot
  }

  /** @param listener - callback notified after a snapshot replacement. @returns its disposer. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Toggle the wide sidebar and the platform-selected compact rail. */
  toggleSidebar(): void {
    if (this.snapshot.narrow) {
      this.publish({ ...this.snapshot, narrowExpanded: !this.snapshot.narrowExpanded })
      return
    }
    this.publish({ ...this.snapshot, sidebar: this.snapshot.sidebar === 0 ? SIDEBAR_DEFAULT : 0 })
  }

  /** @param narrow - whether the frame is below the automatic-collapse breakpoint. */
  setNarrow(narrow: boolean): void {
    if (this.snapshot.narrow === narrow) return
    this.publish({ ...this.snapshot, narrow, narrowExpanded: false })
  }

  /** Open details at its default width. */
  openDetails(): void {
    if (this.snapshot.details === 0) this.publish({ ...this.snapshot, details: DETAILS_DEFAULT })
  }

  /** Close details while keeping its slot mounted. */
  closeDetails(): void {
    if (this.snapshot.details !== 0) this.publish({ ...this.snapshot, details: 0 })
  }

  /** Switch the desktop-owned left surface. */
  setLeftPanel(panel: DesktopLeftPanel): void {
    if (this.snapshot.leftPanel === panel) return
    this.publish({ ...this.snapshot, leftPanel: panel })
  }

  /** Open the artifacts/code panel at its default width. */
  openArtifacts(): void {
    if (this.snapshot.artifacts === 0) this.publish({ ...this.snapshot, artifacts: ARTIFACTS_DEFAULT, artifactsExpanded: false })
  }

  /** Close the artifacts/code panel while keeping its slot mounted. */
  closeArtifacts(): void {
    if (this.snapshot.artifacts !== 0) this.publish({ ...this.snapshot, artifacts: 0, artifactsExpanded: false })
  }

  /** Toggle the artifacts/code panel open/closed. */
  toggleArtifacts(): void {
    if (this.snapshot.artifacts === 0) this.openArtifacts()
    else this.closeArtifacts()
  }

  /** Toggle the artifacts/code panel between its docked and full-window widths. */
  toggleArtifactsExpanded(): void {
    this.publish({
      ...this.snapshot,
      artifactsExpanded: !this.snapshot.artifactsExpanded,
    })
  }

  /** Open the embedded-IDE panel at its default width. */
  openIde(): void {
    if (this.snapshot.ide === 0) this.publish({ ...this.snapshot, ide: IDE_DEFAULT, ideExpanded: false })
  }

  /** Close the embedded-IDE panel while keeping its slot mounted. */
  closeIde(): void {
    if (this.snapshot.ide !== 0) this.publish({ ...this.snapshot, ide: 0, ideExpanded: false })
  }

  /** Toggle the embedded-IDE panel open/closed. */
  toggleIde(): void {
    if (this.snapshot.ide === 0) this.openIde()
    else this.closeIde()
  }

  /** Toggle the embedded-IDE panel between its docked and full-window widths. */
  toggleIdeExpanded(): void {
    this.publish({
      ...this.snapshot,
      ideExpanded: !this.snapshot.ideExpanded,
    })
  }

  /** @param width - requested sidebar width from a resize gesture. */
  setSidebar(width: number): void {
    this.publish({ ...this.snapshot, sidebar: clamp(width, SIDEBAR_MIN, SIDEBAR_MAX) })
  }

  /** @param width - requested details width from a resize gesture. */
  setDetails(width: number): void {
    this.publish({ ...this.snapshot, details: clamp(width, DETAILS_MIN, DETAILS_MAX) })
  }

  /** @param width - requested artifacts/code panel width from a resize gesture. */
  setArtifacts(width: number): void {
    this.publish({ ...this.snapshot, artifacts: clamp(width, ARTIFACTS_MIN, ARTIFACTS_MAX) })
  }

  /** @param width - requested embedded-IDE panel width from a resize gesture. */
  setIde(width: number): void {
    this.publish({ ...this.snapshot, ide: clamp(width, IDE_MIN, IDE_MAX) })
  }

  private publish(next: DesktopLayoutSnapshot): void {
    this.snapshot = Object.freeze(next)
    for (const listener of this.listeners) listener()
  }
}
