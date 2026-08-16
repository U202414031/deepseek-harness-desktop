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
.dshDesktopUpstreamSidebar { box-sizing: border-box; width: 100%; height: 100%; overflow-x: hidden; }
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
.dshDesktopFrame[data-desktop-platform="win32"] .dshDesktopArtifactsSurface { grid-row: 2; }
.dshDesktopWindowsCaptionRow { position: relative; grid-column: 2 / -1; grid-row: 1; min-width: 0; background: var(--dsw-alias-bg-base); }
.dshDesktopWindowsCaptionRow::before { content: ""; position: absolute; inset: 0 ${WINDOWS_CAPTION_CONTROLS_WIDTH}px 0 0; user-select: none; -webkit-app-region: drag; }
.dshDesktopFrame[data-sidebar-collapsed] { transition: grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dshDesktopOverlay { position: absolute; z-index: 1000; inset: 0; pointer-events: none; }
.dshDesktopOverlay > * { pointer-events: auto; }
/* Whale-girl ambient particle layer: a full-window canvas above the chrome but
   below modal overlays (z 1000), with no pointer interception. */
.dshDesktopWhaleAmbient { position: fixed; inset: 0; z-index: 600; pointer-events: none; }
/* Full-window whale-girl backdrop, painted behind the app frame. */
.dshDesktopWhaleBg { position: fixed; inset: 0; z-index: -1; pointer-events: none; background-size: cover; background-position: center; background-repeat: no-repeat; }
/* When a skin supplies a backdrop image, the desktop surfaces become FULLY
   transparent — the whale-girl wallpaper reads through the whole window
   (sidebar, conversation, context) without any scrim or blur, exactly like
   dsh-deep-whale where the interface melts into the artwork. Only the dialog
   cards (bubbles) and the composer (input box) keep a themed frost so text
   stays legible and the look changes with each skin's accent. */
:root[data-skin][data-whale-bg] .dshDesktopSidebarSurface,
:root[data-skin][data-whale-bg] .dshDesktopSidebarRail,
:root[data-skin][data-whale-bg] .dshDesktopSidebarPanel,
:root[data-skin][data-whale-bg] .dshDesktopMacCaptionRow,
:root[data-skin][data-whale-bg] .dshDesktopWindowsCaptionRow,
:root[data-skin][data-whale-bg] .dshDesktopConversationSurface,
:root[data-skin][data-whale-bg] .dshDesktopDetailsSurface,
:root[data-skin][data-whale-bg] .dshDesktopArtifactsSurface {
  background: transparent !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
  border-color: color-mix(in srgb, var(--dsh-desktop-accent) 18%, transparent) !important;
}
/* The upstream chat content also turns see-through so the wallpaper shows. */
:root[data-skin][data-whale-bg] .dshDesktopConversationSurface > * { background-color: transparent !important; }
:root[data-skin][data-whale-bg] body {
  --dsw-alias-bg-base: transparent !important;
  --dsw-alias-bg-layer-1: color-mix(in srgb, var(--dsh-desktop-surface) 38%, transparent) !important;
  --dsw-alias-bg-elevated: color-mix(in srgb, var(--dsh-desktop-surface) 42%, transparent) !important;
}
/* Real dialog cards (bubbles, code blocks) keep a themed frost so the text is
   legible while still feeling like part of the skin. */
:root[data-skin][data-whale-bg] .dshDesktopConversationSurface [class*="bubble"],
:root[data-skin][data-whale-bg] .dshDesktopConversationSurface [class*="Message"] {
  background: color-mix(in srgb, var(--dsh-desktop-surface) 58%, transparent) !important;
  -webkit-backdrop-filter: blur(12px) saturate(1.06);
  backdrop-filter: blur(12px) saturate(1.06);
  border: 1px solid color-mix(in srgb, var(--dsh-desktop-accent) 45%, transparent) !important;
}
/* Composer / input box: a designed, skin-tinted glass pill so it stands out as a
   deliberate UI element while the surrounding surfaces stay fully transparent. */
:root[data-skin][data-whale-bg] .dshDesktopConversationSurface [class*="composer"],
:root[data-skin][data-whale-bg] .dshDesktopConversationSurface [class*="input-area"],
:root[data-skin][data-whale-bg] .dshDesktopConversationSurface [class*="chat-input"],
:root[data-skin][data-whale-bg] .dshDesktopConversationSurface textarea,
:root[data-skin][data-whale-bg] .dshDesktopConversationSurface [contenteditable="true"] {
  background: color-mix(in srgb, var(--dsh-desktop-surface) 32%, transparent) !important;
  -webkit-backdrop-filter: blur(16px) saturate(1.1) !important;
  backdrop-filter: blur(16px) saturate(1.1) !important;
  border: 1px solid color-mix(in srgb, var(--dsh-desktop-accent) 55%, transparent) !important;
  border-radius: 18px !important;
  box-shadow: 0 8px 30px color-mix(in srgb, var(--dsh-desktop-accent) 20%, transparent), inset 0 1px 0 rgba(255,255,255,.12) !important;
  color: var(--dsh-desktop-fg) !important;
}
/* The primary send / submit button inside the composer follows the accent. */
:root[data-skin][data-whale-bg] .dshDesktopConversationSurface [class*="composer"] [class*="send"] {
  background: var(--dsh-desktop-accent) !important;
  color: var(--dsh-desktop-accent-fg, #fff) !important;
  border-color: var(--dsh-desktop-accent) !important;
}
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
   skin tokens, and let the upstream chat content reveal the skinned backdrop.
   We deliberately bind to the desktop-owned --dsh-desktop-* tokens (which every
   skin defines) rather than the upstream --dsw-alias-* names so the change is
   always visible. ---- */
:root[data-skin] .dshDesktopSidebarSurface,
:root[data-skin] .dshDesktopConversationSurface,
:root[data-skin] .dshDesktopDetailsSurface,
:root[data-skin] .dshDesktopArtifactsSurface,
:root[data-skin] .dshDesktopMacCaptionRow,
:root[data-skin] .dshDesktopWindowsCaptionRow { background: var(--dsh-desktop-bg); color: var(--dsh-desktop-fg); border-color: var(--dsh-desktop-border); }
:root[data-skin] .dshDesktopSidebarRail { background: var(--dsh-desktop-surface); }
:root[data-skin] .dshDesktopSidebarPanel { background: var(--dsh-desktop-surface); }
:root[data-skin] .dshDesktopArtifactsSurface { background: var(--dsh-desktop-surface); }
:root[data-skin] .dshDesktopFrame { background: transparent; }
/* Reveal the skinned conversation backdrop through the upstream chat content. */
:root[data-skin] .dshDesktopConversationSurface > * { background-color: transparent !important; }

/* The product chrome (conversation, work-context, chat bubbles, cards, code
   blocks, scrollbars, toasts) reads the framework's --dsw-alias-* tokens, which
   the theme presenter writes as inline styles on <body>. Re-declare them on
   <body> itself with !important so the active skin recolors the entire
   interface — not only the desktop-owned columns. Every skin defines the
   --dsh-desktop-* tokens we map onto, so the coverage is uniform. */
:root[data-skin] body {
  --dsw-alias-bg-base: var(--dsh-desktop-bg) !important;
  --dsw-alias-bg-layer-1: var(--dsh-desktop-surface) !important;
  --dsw-alias-bg-layer-2: var(--dsh-desktop-surface) !important;
  --dsw-alias-bg-layer-3: var(--dsh-desktop-surface-2) !important;
  --dsw-alias-bg-overlay: var(--dsh-desktop-surface-2) !important;
  --dsw-alias-bg-elevated: var(--dsh-desktop-surface) !important;
  --dsw-alias-bg-module-platform: var(--dsh-desktop-surface) !important;
  --dsw-alias-bg-multi-select: var(--dsh-desktop-surface-2) !important;
  --dsw-alias-bg-skeleton: var(--dsh-desktop-surface-2) !important;
  --dsw-alias-border-l1: var(--dsh-desktop-border) !important;
  --dsw-alias-border-l2: var(--dsh-desktop-border) !important;
  --dsw-alias-border-l3: var(--dsh-desktop-border) !important;
  --dsw-alias-border-l4: var(--dsh-desktop-border) !important;
  --dsw-alias-fg-base: var(--dsh-desktop-fg) !important;
  --dsw-alias-fg-muted: var(--dsh-desktop-fg-muted) !important;
  --dsw-alias-label-primary: var(--dsh-desktop-fg) !important;
  --dsw-alias-label-secondary: var(--dsh-desktop-fg-muted) !important;
  --dsw-alias-label-tertiary: var(--dsh-desktop-fg-muted) !important;
  --dsw-alias-label-caption: var(--dsh-desktop-fg-muted) !important;
  --dsw-alias-label-dimmed: var(--dsh-desktop-fg-muted) !important;
  --dsw-alias-brand-primary: var(--dsh-desktop-accent) !important;
  --dsw-alias-brand-text: var(--dsh-desktop-accent-fg, #ffffff) !important;
  --dsw-alias-accent: var(--dsh-desktop-accent) !important;
  --dsw-alias-accent-fg: var(--dsh-desktop-accent-fg, #ffffff) !important;
  --dsw-alias-interactive-bg-hover: var(--dsh-desktop-surface-2) !important;
  --dsw-alias-interactive-bg-hover-solid: var(--dsh-desktop-surface-2) !important;
  --dsw-alias-interactive-bg-active: var(--dsh-desktop-surface-2) !important;
  --dsw-alias-interactive-bg-hover-accent: var(--dsh-desktop-surface-2) !important;
  --dsw-alias-state-business-primary: var(--dsh-desktop-accent) !important;
  --dsw-alias-state-business-tertiary: var(--dsh-desktop-surface-2) !important;
  --dsw-alias-button-primary-fill: var(--dsh-desktop-accent) !important;
  --dsw-alias-button-primary-hover: var(--dsh-desktop-accent) !important;
  --dsw-alias-button-primary-dimmed: var(--dsh-desktop-surface-2) !important;
  --dsw-alias-button-elevated-fill: var(--dsh-desktop-surface) !important;
  --dsw-alias-button-floating-fill: var(--dsh-desktop-surface) !important;
  --dsw-alias-button-floating-hover: var(--dsh-desktop-surface-2) !important;
  --dsw-alias-markdown-code-block: var(--dsh-desktop-code-bg) !important;
  --dsw-alias-markdown-code-block-banner: var(--dsh-desktop-code-bg) !important;
  --dsw-alias-markdown-code-segment-unselected: var(--dsh-desktop-code-bg) !important;
  --dsw-alias-markdown-inline-code: var(--dsh-desktop-code-bg) !important;
  --dsw-alias-markdown-tag: var(--dsh-desktop-surface-2) !important;
  --dsw-alias-scrollbar-bg-l1: var(--dsh-desktop-surface-2) !important;
  --dsw-alias-scrollbar-bg-l2: var(--dsh-desktop-surface-2) !important;
  --dsw-alias-scrollbar-hover-l1: var(--dsh-desktop-border) !important;
  --dsw-alias-scrollbar-hover-l2: var(--dsh-desktop-border) !important;
  --dsw-alias-tooltip-bg: var(--dsh-desktop-surface) !important;
  --dsw-alias-toast-bg: var(--dsh-desktop-surface) !important;
  --dsw-alias-menu: var(--dsh-desktop-surface) !important;
}

/* ---- Left navigation rail + switchable panel column ---- */
.dshDesktopSidebarSurface { display: flex; flex-direction: row; }
.dshDesktopSidebarRail { flex: 0 0 56px; display: flex; flex-direction: column; gap: 6px; padding: 10px 0; align-items: center; background: var(--dsh-desktop-surface); border-right: 1px solid var(--dsh-desktop-border); }
.dshDesktopRailButton { width: 44px; min-height: 44px; padding: 4px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: var(--dsh-desktop-fg-muted); font-size: 12px; line-height: 1.2; cursor: pointer; -webkit-app-region: no-drag; }
.dshDesktopRailButton:hover { background: var(--dsh-desktop-surface-2); color: var(--dsh-desktop-fg); }
.dshDesktopRailButton[data-active] { background: var(--dsh-desktop-accent); color: var(--dsh-desktop-accent-fg); border-color: var(--dsh-desktop-accent); }
.dshDesktopRailDivider { width: 28px; height: 1px; margin: 4px auto; background: var(--dsh-desktop-border); opacity: 0.6; }
.dshDesktopRailFooter { margin-top: auto; padding: 4px 2px; font-size: 9px; line-height: 1.2; color: var(--dsh-desktop-fg-muted); opacity: 0.7; text-align: center; user-select: none; }
.dshDesktopSidebarPanel { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--dsh-desktop-bg); }
.dshDesktopUpstreamSidebar { box-sizing: border-box; width: 100%; height: 100%; overflow-x: hidden; }

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
.dshDesktopSkinRow { display: flex; align-items: stretch; gap: 8px; }
.dshDesktopSkinRow .dshDesktopSkinCard { flex: 1 1 auto; }
.dshDesktopSkinDelete { flex: 0 0 auto; align-self: center; }
.dshDesktopSkinSwatch { flex: 0 0 auto; width: 34px; height: 34px; border-radius: 8px; overflow: hidden; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; border: 1px solid var(--dsh-desktop-border); }
.dshDesktopSkinSwatch span { display: block; }
.dshDesktopSkinMeta { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
.dshDesktopSkinName { font-weight: 600; font-size: 13px; color: var(--dsh-desktop-fg); }
.dshDesktopSkinNameRow { display: flex; align-items: center; gap: 6px; }
.dshDesktopSkinTag { font-size: 10px; padding: 1px 7px; border-radius: 999px; background: var(--dsh-desktop-surface-2); color: var(--dsh-desktop-accent); border: 1px solid var(--dsh-desktop-border); }
.dshDesktopSkinDesc { font-size: 11px; color: var(--dsh-desktop-fg-muted); }
.dshDesktopSkinBadge { flex: 0 0 auto; font-size: 10px; padding: 2px 6px; border-radius: 999px; background: var(--dsh-desktop-accent); color: var(--dsh-desktop-accent-fg); }

/* ---- Skin creator + importer ---- */
.dshDesktopSkinCreator, .dshDesktopSkinImport { padding: 14px 16px; border-top: 1px solid var(--dsh-desktop-border); display: flex; flex-direction: column; gap: 10px; }
.dshDesktopSkinCreatorTitle { margin: 0; font-size: 13px; font-weight: 600; color: var(--dsh-desktop-fg); }
.dshDesktopSkinField { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--dsh-desktop-fg-muted); }
.dshDesktopSearchInput, .dshDesktopSkinTextArea, .dshDesktopFileInput { box-sizing: border-box; width: 100%; padding: 6px 8px; border: 1px solid var(--dsh-desktop-border); border-radius: 8px; background: var(--dsh-desktop-surface); color: var(--dsh-desktop-fg); font-size: 12px; font-family: inherit; }
.dshDesktopSkinTextArea { min-height: 96px; resize: vertical; white-space: pre; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.dshDesktopSkinColors { display: flex; flex-wrap: wrap; gap: 10px; }
.dshDesktopColorField { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 10px; color: var(--dsh-desktop-fg-muted); }
.dshDesktopColorField input[type="color"] { width: 36px; height: 28px; padding: 0; border: 1px solid var(--dsh-desktop-border); border-radius: 8px; background: none; cursor: pointer; }

/* ---- Artifacts / code right panel ---- */
.dshDesktopFrame[data-desktop-platform="darwin"] .dshDesktopArtifactsSurface { grid-row: 1 / -1; }
.dshDesktopArtifactsSurface { grid-column: 4; grid-row: 1; min-width: 0; min-height: 0; overflow: hidden; background: var(--dsh-desktop-surface); border-left: 1px solid var(--dsh-desktop-border); box-shadow: var(--dsh-desktop-sidebar-shadow, -8px 0 24px rgba(0, 0, 0, 0.12)); display: flex; flex-direction: column; }
.dshDesktopArtifactsPanel { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.dshDesktopArtifactsTabs { display: flex; gap: 6px; padding: 10px 12px; }
.dshDesktopArtifactsTab { font-size: 12px; padding: 6px 12px; border: 1px solid var(--dsh-desktop-border); border-radius: 999px; background: var(--dsh-desktop-surface); color: var(--dsh-desktop-fg-muted); cursor: pointer; -webkit-app-region: no-drag; }
.dshDesktopArtifactsTab[aria-selected="true"] { background: var(--dsh-desktop-accent); color: var(--dsh-desktop-accent-fg); border-color: var(--dsh-desktop-accent); }
.dshDesktopArtifactsBody { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 10px 12px; }

/* ---- API settings (left panel) ---- */
.dshDesktopApiSettings { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; overflow-y: auto; }
.dshDesktopApiActions { display: flex; gap: 8px; }
.dshDesktopApiStatus { font-size: 12px; color: var(--dsh-desktop-accent); margin: 0; }
.dshDesktopApiQuery { align-self: flex-start; }
.dshDesktopBalanceList { display: flex; flex-direction: column; gap: 10px; }
.dshDesktopBalanceCard { border: 1px solid var(--dsh-desktop-border); border-radius: 10px; padding: 10px 12px; background: var(--dsh-desktop-surface); display: flex; flex-direction: column; gap: 6px; }
.dshDesktopBalanceRow { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; }
.dshDesktopBalanceRow span { color: var(--dsh-desktop-fg-muted); }
.dshDesktopBalanceRow b { color: var(--dsh-desktop-fg); font-weight: 600; }

/* ---- API panel: provider auto-detection + provider links ---- */
.dshDesktopProviderDetect { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 1px solid var(--dsh-desktop-border); border-radius: 10px; background: var(--dsh-desktop-surface); }
.dshDesktopProviderDetectLabel { font-size: 11px; color: var(--dsh-desktop-fg-muted); }
.dshDesktopProviderDetectValue { font-size: 13px; font-weight: 600; color: var(--dsh-desktop-fg); word-break: break-all; }
.dshDesktopProviderDetectNone { color: var(--dsh-desktop-fg-muted); font-weight: 500; }
.dshDesktopApiLinks { display: flex; flex-direction: column; gap: 8px; margin-top: 2px; }
.dshDesktopApiLink { text-align: center; text-decoration: none; -webkit-app-region: no-drag; }
a.dshDesktopApiLink.dshDesktopPrimaryButton { color: var(--dsh-desktop-accent-fg); }
a.dshDesktopApiLink.dshDesktopSecondaryButton { color: var(--dsh-desktop-fg); }


/* ---- Usage tab (right panel) ---- */
.dshDesktopUsageWrap { display: flex; flex-direction: column; gap: 10px; }
.dshDesktopUsageTotal { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 1px solid var(--dsh-desktop-border); border-radius: 10px; background: var(--dsh-desktop-surface); font-size: 12px; color: var(--dsh-desktop-fg-muted); }
.dshDesktopUsageTotal b { color: var(--dsh-desktop-fg); font-size: 13px; }
.dshDesktopUsageList { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.dshDesktopUsageRow { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 1px solid var(--dsh-desktop-border); border-radius: 10px; background: var(--dsh-desktop-surface); }
.dshDesktopUsageTurn { font-size: 13px; font-weight: 600; color: var(--dsh-desktop-fg); }
.dshDesktopUsageNumbers { font-size: 12px; color: var(--dsh-desktop-fg-muted); }
.dshDesktopUsageCache, .dshDesktopUsagePrice { font-size: 11px; color: var(--dsh-desktop-accent); }
.dshDesktopArtifactsHeader { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dshDesktopArtifactsHeader__buttons { display: flex; align-items: center; gap: 2px; margin-left: auto; }
.dshDesktopIconButton { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--dsh-desktop-fg-muted); cursor: pointer; -webkit-app-region: no-drag; }
.dshDesktopIconButton:hover { background: var(--dsh-desktop-surface-2); color: var(--dsh-desktop-fg); }
.dshDesktopIconButton:active { background: var(--dsh-desktop-accent); color: var(--dsh-desktop-accent-fg); }
.dshDesktopIconButton svg { width: 18px; height: 18px; display: block; }
.dshDesktopArtifactsReopen { display: inline-flex; align-items: center; justify-content: center; width: 100%; height: 100%; border: 0; background: transparent; color: var(--dsh-desktop-fg-muted); cursor: pointer; -webkit-app-region: no-drag; }
.dshDesktopArtifactsReopen:hover { background: var(--dsh-desktop-surface-2); color: var(--dsh-desktop-fg); }
.dshDesktopArtifactsReopen svg { width: 18px; height: 18px; display: block; }
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

/* ---- External tools (left panel) ---- */
.dshDesktopTools { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; overflow-y: auto; }
.dshDesktopToolsTabs { display: flex; gap: 6px; }
.dshDesktopToolsTab { flex: 1 1 0; padding: 7px 4px; border: 1px solid var(--dsh-desktop-border); border-radius: 9px; background: var(--dsh-desktop-surface); color: var(--dsh-desktop-fg-muted); font-size: 12px; cursor: pointer; -webkit-app-region: no-drag; transition: border-color .15s, color .15s; }
.dshDesktopToolsTab[data-active] { font-weight: 600; background: var(--dsh-desktop-surface-2); }
.dshDesktopToolsCard { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--dsh-desktop-border); border-radius: 12px; background: var(--dsh-desktop-surface); }
.dshDesktopToolsStatus { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--dsh-desktop-fg-muted); }
.dshDesktopToolsStatus b { font-weight: 600; }
.dshDesktopToolsStatus b[data-status="connected"] { color: #1f9d55; }
.dshDesktopToolsStatus b[data-status="error"] { color: #d6455a; }
.dshDesktopToolsNote { font-size: 11px; line-height: 1.5; color: var(--dsh-desktop-fg-muted); margin: 0; }
.dshDesktopToolsDocLink { font-size: 11px; color: var(--dsh-desktop-accent); text-decoration: none; -webkit-app-region: no-drag; }
.dshDesktopToolsSection { margin: 2px 0 0; font-size: 13px; font-weight: 600; color: var(--dsh-desktop-fg); }
.dshDesktopToolsSend { display: flex; gap: 8px; align-items: stretch; }
.dshDesktopToolsSend textarea, .dshDesktopToolsSend input { flex: 1 1 auto; }
.dshDesktopToolsTextarea { min-height: 64px; resize: vertical; font-family: inherit; }
.dshDesktopToolsWideBtn { width: 100%; justify-content: center; }
.dshDesktopToolsSummary { white-space: pre-wrap; font-size: 12px; line-height: 1.6; color: var(--dsh-desktop-fg); background: var(--dsh-desktop-surface-2); border-radius: 8px; padding: 8px 10px; }
.dshDesktopToolsTasks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.dshDesktopToolsTask { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid var(--dsh-desktop-border); border-radius: 8px; background: var(--dsh-desktop-surface-2); }
.dshDesktopToolsTaskMain { display: flex; align-items: center; gap: 8px; flex: 1 1 auto; font-size: 12px; color: var(--dsh-desktop-fg); cursor: pointer; }
.dshDesktopToolsTaskDone { text-decoration: line-through; color: var(--dsh-desktop-fg-muted); }
.dshDesktopToolsTaskDel { border: 0; background: transparent; color: var(--dsh-desktop-fg-muted); font-size: 16px; line-height: 1; cursor: pointer; -webkit-app-region: no-drag; }
.dshDesktopToolsTaskDel:hover { color: #d6455a; }
.dshDesktopToolsMessages { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow-y: auto; }
.dshDesktopToolsMsg { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border: 1px solid var(--dsh-desktop-border); border-radius: 8px; background: var(--dsh-desktop-surface-2); }
.dshDesktopToolsMsgSender { font-size: 11px; font-weight: 600; color: var(--dsh-desktop-accent); }
.dshDesktopToolsMsgText { font-size: 12px; color: var(--dsh-desktop-fg); white-space: pre-wrap; word-break: break-word; }
.dshDesktopToolsInfo { font-size: 12px; color: #1f9d55; margin: 0; }

/* ---- Tools: auto-summary digest history ---- */
.dshDesktopToolsSummaries { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto; }
.dshDesktopToolsSummaryItem { border: 1px solid var(--dsh-desktop-border); border-radius: 9px; padding: 8px 10px; background: var(--dsh-desktop-surface-2); }
.dshDesktopToolsSummaryHead { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: var(--dsh-desktop-fg-muted); margin-bottom: 5px; }
.dshDesktopToolsSummaryTarget { color: var(--dsh-desktop-accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%; }
.dshDesktopToolsSummaryItem .dshDesktopToolsSummary { background: var(--dsh-desktop-surface); }

/* ---- Tools: target type selector + scheduled send ---- */
.dshDesktopToolsTypeRow { display: flex; gap: 6px; }
.dshDesktopToolsTypeBtn { flex: 1 1 0; padding: 6px 4px; border: 1px solid var(--dsh-desktop-border); border-radius: 8px; background: var(--dsh-desktop-surface); color: var(--dsh-desktop-fg-muted); font-size: 12px; cursor: pointer; -webkit-app-region: no-drag; transition: border-color .15s, color .15s, background .15s; }
.dshDesktopToolsTypeBtn[data-active] { font-weight: 600; color: var(--dsh-desktop-fg); background: var(--dsh-desktop-surface-2); border-color: var(--dsh-desktop-accent); }
.dshDesktopToolsTimeInput { color-scheme: light; }
.dshDesktopToolsSched { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.dshDesktopToolsSchedItem { display: flex; flex-direction: column; gap: 4px; padding: 7px 9px; border: 1px solid var(--dsh-desktop-border); border-radius: 9px; background: var(--dsh-desktop-surface-2); }
.dshDesktopToolsSchedMain { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; font-size: 12px; }
.dshDesktopToolsSchedTime { font-weight: 600; color: var(--dsh-desktop-fg); }
.dshDesktopToolsSchedTarget { color: var(--dsh-desktop-accent); max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshDesktopToolsSchedText { flex: 1 1 100%; color: var(--dsh-desktop-fg-muted); white-space: pre-wrap; word-break: break-word; }
.dshDesktopToolsSchedSide { display: flex; align-items: center; gap: 6px; }
.dshDesktopToolsBadge { font-size: 11px; padding: 1px 7px; border-radius: 999px; font-weight: 600; background: var(--dsh-desktop-surface); color: var(--dsh-desktop-fg-muted); }
.dshDesktopToolsBadge[data-status="sent"] { color: #1f9d55; }
.dshDesktopToolsBadge[data-status="failed"], .dshDesktopToolsBadge[data-status="missed"] { color: #d6455a; }
.dshDesktopToolsBadge[data-status="pending"] { color: var(--dsh-desktop-accent); }
.dshDesktopToolsSchedResult { font-size: 11px; color: var(--dsh-desktop-fg-muted); margin: 0; }
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
