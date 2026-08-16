import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './contracts.ts'
import type { DesktopClientPlatform } from './environment.ts'
import {
  ARTIFACTS_RAIL, computeDesktopColumns, DesktopLayoutState, MACOS_SIDEBAR_COLLAPSED,
  SIDEBAR_AUTO_COLLAPSE, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT,
} from './layout-state.ts'

/** Private values assembled by the advanced-shell registration. */
export interface AdvancedFrameInjected {
  /** Desktop-owned panel state exposed through the standard layout service. */
  layout: DesktopLayoutState
  /** Host platform controlling native title-bar spacing. */
  platform: DesktopClientPlatform
}

/** Full advanced root slot props. */
export type AdvancedFrameProps = PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'sidebar.marketplace' | 'sidebar.skins' | 'artifacts' | 'shell.overlay'>
  & AdvancedFrameInjected

/** Desktop-owned transparent frame around the unchanged product surfaces. */
export function AdvancedFrame({ layout, platform, renderSlot, useSessions }: AdvancedFrameProps) {
  const subscribeLayout = useCallback((listener: () => void) => layout.subscribe(listener), [layout])
  const readLayout = useCallback(() => layout.getSnapshot(), [layout])
  const panels = useSyncExternalStore(subscribeLayout, readLayout)
  const frameRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)
  const detailsSession = useSessions((state) => {
    const current = state.current
    return current !== undefined && state.byId[current]?.blank === false ? current : undefined
  })
  const hasSession = useSessions((state) => state.current !== undefined)

  useEffect(() => {
    const element = frameRef.current
    if (element === null) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined && entry.contentRect.width > 0) setViewport(entry.contentRect.width)
    })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [])

  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => { layout.setNarrow(narrow) }, [layout, narrow])

  const previousSession = useRef(detailsSession)
  useEffect(() => {
    if (detailsSession !== undefined && previousSession.current !== undefined && previousSession.current !== detailsSession) {
      layout.closeDetails()
    }
    previousSession.current = detailsSession
  }, [detailsSession, layout])

  const collapsed = panels.narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarPreference = collapsed ? 0 : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
  const columns = computeDesktopColumns(
    viewport,
    sidebarPreference,
    detailsSession === undefined ? 0 : panels.details,
    platform === 'darwin' ? MACOS_SIDEBAR_COLLAPSED : SIDEBAR_COLLAPSED,
    panels.artifacts,
  )

  return (
    <div
      ref={frameRef}
      className="dshDesktopFrame"
      data-desktop-platform={platform}
      data-sidebar-collapsed={collapsed || undefined}
      style={{ gridTemplateColumns: `${columns.sidebar}px minmax(0, 1fr) ${columns.details}px ${columns.artifacts}px` }}
    >
      {platform === 'darwin' && <div className="dshDesktopMacCaptionRow" aria-hidden="true" />}
      {platform === 'win32' && <div className="dshDesktopWindowsCaptionRow" aria-hidden="true" />}
      <aside className="dshDesktopSidebarSurface">
        <nav className="dshDesktopSidebarRail" aria-label="桌面导航">
          <button
            type="button"
            className="dshDesktopRailButton"
            data-active={panels.leftPanel === 'chat' || undefined}
            title="对话"
            aria-label="对话"
            aria-pressed={panels.leftPanel === 'chat'}
            onClick={() => { layout.setLeftPanel('chat') }}
          >
            对话
          </button>
          <button
            type="button"
            className="dshDesktopRailButton"
            data-active={panels.leftPanel === 'marketplace' || undefined}
            title="插件市场"
            aria-label="插件市场"
            aria-pressed={panels.leftPanel === 'marketplace'}
            onClick={() => { layout.setLeftPanel('marketplace') }}
          >
            市场
          </button>
          <button
            type="button"
            className="dshDesktopRailButton"
            data-active={panels.leftPanel === 'skins' || undefined}
            title="皮肤"
            aria-label="皮肤"
            aria-pressed={panels.leftPanel === 'skins'}
            onClick={() => { layout.setLeftPanel('skins') }}
          >
            皮肤
          </button>
          <div className="dshDesktopRailDivider" aria-hidden="true" />
          <button
            type="button"
            className="dshDesktopRailButton"
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
            aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
            aria-pressed={collapsed}
            onClick={() => { layout.toggleSidebar() }}
          >
            {collapsed ? '»' : '«'}
          </button>
        </nav>
        <div className="dshDesktopSidebarPanel">
          {panels.leftPanel === 'chat' && (
            <div className="dshDesktopUpstreamSidebar">
              {renderSlot('sidebar', { collapsed, width: collapsed ? columns.sidebar : Math.max(0, columns.sidebar - 56) })}
            </div>
          )}
          {panels.leftPanel === 'marketplace' && renderSlot('sidebar.marketplace', {})}
          {panels.leftPanel === 'skins' && renderSlot('sidebar.skins', {})}
        </div>
      </aside>
      <main className="dshDesktopConversationSurface">{renderSlot('conversation', {})}</main>
      <aside className="dshDesktopDetailsSurface">{renderSlot('details', {})}</aside>
      <aside className="dshDesktopArtifactsSurface" data-open={panels.artifacts > 0 || undefined}>
        {panels.artifacts > 0 ? (
          <>
            <header className="dshDesktopFeatureHeader dshDesktopArtifactsHeader">
              <h2 className="dshDesktopFeatureTitle">产物与代码</h2>
              <div className="dshDesktopArtifactsHeader__buttons">
                <button
                  type="button"
                  className="dshDesktopIconButton"
                  title={panels.artifactsExpanded ? '还原面板宽度' : '放大面板'}
                  aria-label={panels.artifactsExpanded ? '还原面板宽度' : '放大面板'}
                  aria-pressed={panels.artifactsExpanded}
                  onClick={() => { layout.toggleArtifactsExpanded() }}
                >
                  {panels.artifactsExpanded ? (
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h8" /><path d="M4 6l2 2-2 2" /><path d="M12 6l-2 2 2 2" /></svg>
                  ) : (
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 8h4M4 6l-2 2 2 2" /><path d="M14 8h-4M12 6l2 2-2 2" /></svg>
                  )}
                </button>
                <button
                  type="button"
                  className="dshDesktopIconButton"
                  title="收起产物面板"
                  aria-label="收起产物面板"
                  onClick={() => { layout.closeArtifacts() }}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
                </button>
              </div>
            </header>
            {hasSession ? (
              <div className="dshDesktopArtifactsPanel">{renderSlot('artifacts', {})}</div>
            ) : (
              <div className="dshDesktopArtifactsPanel">
                <p className="dshDesktopEmptyState">开始一段对话后，代码块与工具产物会显示在这里。</p>
              </div>
            )}
          </>
        ) : (
          <button
            type="button"
            className="dshDesktopArtifactsReopen"
            title="展开产物面板"
            aria-label="展开产物面板"
            onClick={() => { layout.openArtifacts() }}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 4l-4 4 4 4" /></svg>
          </button>
        )}
      </aside>
      <div className="dshDesktopOverlay" data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
      {!collapsed && (
        <ResizeHandle
          side="sidebar"
          left={columns.sidebar}
          size={columns.sidebar}
          onResize={(width) => { layout.setSidebar(width) }}
        />
      )}
      {columns.details > 0 && (
        <ResizeHandle
          side="details"
          left={viewport - columns.details}
          size={columns.details}
          onResize={(width) => { layout.setDetails(width) }}
        />
      )}
      {columns.artifacts > ARTIFACTS_RAIL && (
        <ResizeHandle
          side="artifacts"
          left={viewport - columns.artifacts}
          size={columns.artifacts}
          onResize={(width) => { layout.setArtifacts(width) }}
        />
      )}
    </div>
  )
}

function ResizeHandle(props: { side: 'sidebar' | 'details' | 'artifacts'; left: number; size: number; onResize: (width: number) => void }) {
  const origin = useRef(0)
  const base = useRef(0)
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    origin.current = event.clientX
    base.current = props.size
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [props.size])
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const delta = event.clientX - origin.current
    props.onResize(base.current + (props.side === 'sidebar' ? delta : -delta))
  }, [props])
  return (
    <div
      className="dshDesktopResizeHandle"
      data-side={props.side}
      style={{ left: props.left }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    />
  )
}
