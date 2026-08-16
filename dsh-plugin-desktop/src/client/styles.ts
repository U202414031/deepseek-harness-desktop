import {
  MACOS_DRAG_REGION_HEIGHT,
  MACOS_TITLEBAR_HEIGHT,
  MACOS_TRAFFIC_LIGHT_SAFE_WIDTH,
  WINDOWS_CAPTION_CONTROLS_WIDTH,
  WINDOWS_TITLEBAR_HEIGHT,
} from '../window-chrome.ts'
import { SIDEBAR_COLLAPSED } from './layout-state.ts'

/** Advanced-shell stylesheet kept as a plain string so the package client bundle stays self-contained. */
const ADVANCED_STYLES = `
html, body, #root { width: 100%; height: 100%; }
body[data-dsh-desktop-mode="advanced"] { margin: 0; background: transparent !important; }
.dshDesktopFrame { position: relative; display: grid; grid-template-rows: 100%; width: 100%; height: 100%; overflow: hidden; background: transparent; }
.dshDesktopSidebarSurface { --dsw-specific-sidebar-fill: transparent; position: relative; grid-column: 1; grid-row: 1; min-width: 0; overflow: hidden; background: transparent; border-right: 1px solid var(--dsw-alias-border-l1); }
.dshDesktopUpstreamSidebar { box-sizing: border-box; width: 100%; height: 100%; }
.dshDesktopFrame[data-desktop-platform="darwin"] .dshDesktopUpstreamSidebar { padding-top: ${MACOS_TITLEBAR_HEIGHT}px; -webkit-app-region: no-drag; }
.dshDesktopFrame[data-desktop-platform="darwin"][data-sidebar-collapsed] .dshDesktopUpstreamSidebar { width: ${SIDEBAR_COLLAPSED}px; margin: 0 auto; }
.dshDesktopFrame[data-desktop-platform="darwin"] { grid-template-rows: ${MACOS_TITLEBAR_HEIGHT}px minmax(0, 1fr); }
.dshDesktopFrame[data-desktop-platform="darwin"] .dshDesktopSidebarSurface { grid-row: 1 / -1; -webkit-app-region: no-drag; }
.dshDesktopFrame[data-desktop-platform="darwin"] .dshDesktopConversationSurface,
.dshDesktopFrame[data-desktop-platform="darwin"] .dshDesktopDetailsSurface { grid-row: 2; }
.dshDesktopFrame[data-desktop-platform="darwin"] .dshDesktopSidebarSurface::before { content: ""; position: absolute; top: 0; right: 0; left: ${MACOS_TRAFFIC_LIGHT_SAFE_WIDTH}px; height: ${MACOS_DRAG_REGION_HEIGHT}px; user-select: none; -webkit-app-region: drag; }
.dshDesktopMacCaptionRow { position: relative; grid-column: 2 / -1; grid-row: 1; min-width: 0; background: var(--dsw-alias-bg-base); }
.dshDesktopMacCaptionRow::before { content: ""; position: absolute; top: 0; right: 0; left: 0; height: ${MACOS_DRAG_REGION_HEIGHT}px; user-select: none; -webkit-app-region: drag; }
.dshDesktopConversationSurface { grid-column: 2; grid-row: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--dsw-alias-bg-base); }
.dshDesktopDetailsSurface { grid-column: 3; grid-row: 1; min-width: 0; min-height: 0; overflow: hidden; background: var(--dsw-alias-bg-base); border-left: 1px solid var(--dsw-alias-border-l2); }
.dshDesktopFrame[data-desktop-platform="win32"] { grid-template-rows: ${WINDOWS_TITLEBAR_HEIGHT}px minmax(0, 1fr); }
.dshDesktopFrame[data-desktop-platform="win32"] .dshDesktopSidebarSurface { grid-row: 1 / -1; }
.dshDesktopFrame[data-desktop-platform="win32"] .dshDesktopConversationSurface,
.dshDesktopFrame[data-desktop-platform="win32"] .dshDesktopDetailsSurface { grid-row: 2; }
.dshDesktopWindowsCaptionRow { position: relative; grid-column: 2 / -1; grid-row: 1; min-width: 0; background: var(--dsw-alias-bg-base); }
.dshDesktopWindowsCaptionRow::before { content: ""; position: absolute; inset: 0 ${WINDOWS_CAPTION_CONTROLS_WIDTH}px 0 0; user-select: none; -webkit-app-region: drag; }
.dshDesktopFrame[data-sidebar-collapsed] { transition: grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dshDesktopOverlay { position: absolute; z-index: 1000; inset: 0; pointer-events: none; }
.dshDesktopOverlay > * { pointer-events: auto; }
.dshDesktopResizeHandle { position: absolute; z-index: 50; top: 0; bottom: 0; width: 8px; margin-left: -4px; cursor: col-resize; touch-action: none; -webkit-app-region: no-drag; }
.dshDesktopNoDrag, button, input, textarea, select, a, [role="button"], [role="dialog"], [role="presentation"] { -webkit-app-region: no-drag; }
[role="dialog"], [aria-modal="true"] { -webkit-app-region: no-drag !important; }
html:has([aria-modal="true"]) .dshDesktopWindowsCaptionRow::before,
html:has([aria-modal="true"]) .dshDesktopMacCaptionRow::before,
html:has([aria-modal="true"]) .dshDesktopSidebarSurface,
html:has([aria-modal="true"]) .dshDesktopSidebarSurface::before { -webkit-app-region: no-drag !important; }
@media (prefers-reduced-motion: reduce) { .dshDesktopFrame { transition: none !important; } }

/* ---- Desktop-owned design tokens (overridden by the skin service) ---- */
:root {
  --dsh-desktop-bg: var(--dsw-alias-bg-base, #ffffff);
  --dsh-desktop-surface: var(--dsw-alias-bg-elevated, #f5f5f7);
  --dsh-desktop-surface-2: var(--dsw-alias-bg-overlay, #ececf0);
  --dsh-desktop-fg: var(--dsw-alias-fg-base, #1a1a1a);
  --dsh-desktop-fg-muted: var(--dsw-alias-fg-muted, #6b6b76);
  --dsh-desktop-border: var(--dsw-alias-border-l1, #e2e2e8);
  --dsh-desktop-accent: var(--dsw-alias-accent, #4f46e5);
  --dsh-desktop-accent-fg: #ffffff;
  --dsh-desktop-code-bg: var(--dsw-alias-bg-overlay, #f0f0f4);
}

/* ---- Whole-interface skinning: when a skin is active, force every desktop
   surface (sidebar, conversation, details, artifacts, caption bars) to adopt the
   skin tokens, and let the upstream chat content reveal the skinned backdrop. ---- */
:root[data-skin] .dshDesktopSidebarSurface,
:root[data-skin] .dshDesktopSidebarRail,
:root[data-skin] .dshDesktopSidebarPanel,
:root[data-skin] .dshDesktopConversationSurface,
:root[data-skin] .dshDesktopDetailsSurface,
:root[data-skin] .dshDesktopArtifactsSurface,
:root[data-skin] .dshDesktopMacCaptionRow,
:root[data-skin] .dshDesktopWindowsCaptionRow { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-fg-base); }
:root[data-skin] .dshDesktopSidebarRail { background: var(--dsh-desktop-surface); }
:root[data-skin] .dshDesktopSidebarPanel { background: var(--dsh-desktop-bg); }
:root[data-skin] .dshDesktopFrame { background: transparent; }
/* Reveal the skinned conversation backdrop through the upstream chat content. */
:root[data-skin] .dshDesktopConversationSurface > * { background-color: transparent !important; }

/* ---- Left navigation rail + switchable panel column ---- */
.dshDesktopSidebarSurface { display: flex; flex-direction: row; }
.dshDesktopSidebarRail { flex: 0 0 56px; display: flex; flex-direction: column; gap: 6px; padding: 10px 0; align-items: center; background: var(--dsh-desktop-surface); border-right: 1px solid var(--dsh-desktop-border); }
.dshDesktopRailButton { width: 44px; min-height: 44px; padding: 4px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: var(--dsh-desktop-fg-muted); font-size: 12px; line-height: 1.2; cursor: pointer; -webkit-app-region: no-drag; }
.dshDesktopRailButton:hover { background: var(--dsh-desktop-surface-2); color: var(--dsh-desktop-fg); }
.dshDesktopRailButton[data-active] { background: var(--dsh-desktop-accent); color: var(--dsh-desktop-accent-fg); border-color: var(--dsh-desktop-accent); }
.dshDesktopSidebarPanel { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--dsh-desktop-bg); }
.dshDesktopUpstreamSidebar { box-sizing: border-box; width: 100%; height: 100%; }

/* ---- Feature surfaces (marketplace / skins / artifacts) ---- */
.dshDesktopMarketplace, .dshDesktopSkins, .dshDesktopArtifacts { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--dsh-desktop-fg); }
.dshDesktopFeatureHeader { padding: 14px 16px 10px; border-bottom: 1px solid var(--dsh-desktop-border); }
.dshDesktopFeatureTitle { margin: 0; font-size: 15px; font-weight: 600; }
.dshDesktopFeatureSubtitle { margin: 4px 0 10px; font-size: 12px; color: var(--dsh-desktop-fg-muted); }
.dshDesktopEmptyState, .dshDesktopMarketplaceNote { padding: 16px; font-size: 13px; color: var(--dsh-desktop-fg-muted); }
.dshDesktopMarketplaceLog { margin: 0 12px 8px; padding: 8px 10px; max-height: 160px; overflow: auto; white-space: pre-wrap; font-size: 11px; background: var(--dsh-desktop-code-bg); border: 1px solid var(--dsh-desktop-border); border-radius: 8px; color: var(--dsh-desktop-fg-muted); }

/* ---- Buttons ---- */
.dshDesktopPrimaryButton, .dshDesktopSecondaryButton, .dshDesktopDangerButton, .dshDesktopLinkButton { font-size: 12px; border-radius: 8px; padding: 6px 12px; cursor: pointer; border: 1px solid var(--dsh-desktop-border); -webkit-app-region: no-drag; }
.dshDesktopPrimaryButton { background: var(--dsh-desktop-accent); color: var(--dsh-desktop-accent-fg); border-color: var(--dsh-desktop-accent); }
.dshDesktopSecondaryButton { background: var(--dsh-desktop-surface-2); color: var(--dsh-desktop-fg); }
.dshDesktopDangerButton { background: transparent; color: #d6455a; border-color: #d6455a; }
.dshDesktopLinkButton { background: transparent; color: var(--dsh-desktop-accent); text-decoration: none; border-color: transparent; padding: 6px 4px; }
.dshDesktopPrimaryButton:disabled, .dshDesktopSecondaryButton:disabled, .dshDesktopDangerButton:disabled { opacity: 0.55; cursor: default; }

/* ---- Marketplace ---- */
.dshDesktopPluginList, .dshDesktopSkinList { list-style: none; margin: 0; padding: 10px 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; flex: 1 1 auto; min-height: 0; }
.dshDesktopPluginCard { border: 1px solid var(--dsh-desktop-border); border-radius: 10px; padding: 12px; background: var(--dsh-desktop-surface); }
.dshDesktopPluginHead { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.dshDesktopPluginName { font-weight: 600; font-size: 13px; }
.dshDesktopPluginStars { font-size: 11px; color: var(--dsh-desktop-fg-muted); }
.dshDesktopPluginDesc { margin: 6px 0; font-size: 12px; color: var(--dsh-desktop-fg-muted); }
.dshDesktopPluginTags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.dshDesktopPluginTag { font-size: 10px; padding: 2px 6px; border-radius: 999px; background: var(--dsh-desktop-surface-2); color: var(--dsh-desktop-fg-muted); }
.dshDesktopPluginActions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* ---- Skins ---- */
.dshDesktopSkinCard { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--dsh-desktop-border); border-radius: 10px; background: var(--dsh-desktop-surface); cursor: pointer; text-align: left; -webkit-app-region: no-drag; }
.dshDesktopSkinCard[data-selected] { border-color: var(--dsh-desktop-accent); box-shadow: 0 0 0 1px var(--dsh-desktop-accent); }
.dshDesktopSkinSwatch { flex: 0 0 auto; width: 34px; height: 34px; border-radius: 8px; overflow: hidden; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; border: 1px solid var(--dsh-desktop-border); }
.dshDesktopSkinSwatch span { display: block; }
.dshDesktopSkinMeta { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
.dshDesktopSkinName { font-weight: 600; font-size: 13px; color: var(--dsh-desktop-fg); }
.dshDesktopSkinDesc { font-size: 11px; color: var(--dsh-desktop-fg-muted); }
.dshDesktopSkinBadge { flex: 0 0 auto; font-size: 10px; padding: 2px 6px; border-radius: 999px; background: var(--dsh-desktop-accent); color: var(--dsh-desktop-accent-fg); }

/* ---- Artifacts / code right panel ---- */
.dshDesktopArtifactsSurface { grid-column: 4; grid-row: 1; min-width: 0; min-height: 0; overflow: hidden; background: var(--dsh-desktop-bg); border-left: 1px solid var(--dsh-desktop-border); display: flex; flex-direction: column; }
.dshDesktopArtifactsTabs { display: flex; gap: 4px; padding: 8px 12px 0; }
.dshDesktopArtifactsTab { font-size: 12px; padding: 6px 10px; border: 1px solid transparent; border-bottom: none; border-radius: 8px 8px 0 0; background: transparent; color: var(--dsh-desktop-fg-muted); cursor: pointer; -webkit-app-region: no-drag; }
.dshDesktopArtifactsTab[aria-selected="true"] { color: var(--dsh-desktop-fg); background: var(--dsh-desktop-surface); }
.dshDesktopArtifactsBody { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 10px 12px; }
.dshDesktopEmptyState { color: var(--dsh-desktop-fg-muted); font-size: 13px; padding: 8px; }
.dshDesktopCodeList, .dshDesktopArtifactList { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.dshDesktopCodeCard, .dshDesktopArtifactCard { border: 1px solid var(--dsh-desktop-border); border-radius: 10px; overflow: hidden; background: var(--dsh-desktop-surface); }
.dshDesktopCodeHead { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--dsh-desktop-border); }
.dshDesktopCodeLang { font-size: 11px; font-weight: 600; color: var(--dsh-desktop-fg); }
.dshDesktopCodeSource { font-size: 11px; color: var(--dsh-desktop-fg-muted); flex: 1 1 auto; }
.dshDesktopCodeCopy { padding: 2px 8px; }
.dshDesktopCodeBlock { margin: 0; padding: 10px 12px; max-height: 320px; overflow: auto; background: var(--dsh-desktop-code-bg); font-size: 12px; line-height: 1.5; white-space: pre; }
.dshDesktopArtifactHead { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--dsh-desktop-border); }
.dshDesktopArtifactTool { font-size: 12px; font-weight: 600; }
.dshDesktopArtifactError { font-size: 10px; padding: 2px 6px; border-radius: 999px; background: #fde8eb; color: #d6455a; }
.dshDesktopArtifactText { margin: 0; padding: 10px 12px; max-height: 280px; overflow: auto; font-size: 12px; line-height: 1.5; white-space: pre-wrap; }
`


/** Install and remove the advanced shell's global native-window styles. @returns the style disposer. */
export function installAdvancedStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-plugin-desktop'
  style.dataset.pluginCss = 'dsh-plugin-desktop/advanced-shell'
  style.textContent = ADVANCED_STYLES
  document.head.appendChild(style)
  return () => { style.remove() }
}
