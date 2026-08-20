/**
 * Host half of the IDE-bridge bundle: embedded IDE (code-server) lifecycle,
 * the selection→agent bridge, native VS Code linkage and the built-in
 * lightweight editor routes. Advanced shell only — degrades to a no-op when the
 * desktop settings mode is not `advanced` or the optional `desktopProfiles` /
 * `agents` services are absent.
 */
import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional desktop profile service provided by dsh-plugin-desktop. */
    desktopProfiles?: { current: { dir: string } }
  }
}
import { loadIdeConfig } from './ide-config.ts'
import { startIdeServer, type IdeServerHandle } from './ide-server.ts'
import {
  handleIdeInfoRequest,
  handleIdeConfigRequest,
  handleIdeAskRequest,
  handleIdeOpenRequest,
  handleIdeStartRequest,
  writeIdeBridgeConfig,
  writeEmbeddedIdeBridgeConfig,
} from './ide-routes.ts'
import { handleIdeTreeRequest, handleIdeFileRequest, handleIdeWorkspaceRequest } from './ide-editor-routes.ts'
import {
  DESKTOP_IDE_INFO_PATH,
  DESKTOP_IDE_CONFIG_PATH,
  DESKTOP_IDE_ASK_PATH,
  DESKTOP_IDE_OPEN_PATH,
  DESKTOP_IDE_START_PATH,
} from './ide-info-contract.ts'
import {
  DESKTOP_IDE_TREE_PATH,
  DESKTOP_IDE_FILE_PATH,
  DESKTOP_IDE_WORKSPACE_PATH,
} from './ide-editor-contract.ts'

const DESKTOP_SETTINGS_NAMESPACE = settingsNamespace('dsh-desktop')

export const name = 'desktop-ide-bridge'
export const inject = ['webServer', 'settings']

export function apply(ctx: Context): void {
  const settings = ctx.settings.get(DESKTOP_SETTINGS_NAMESPACE) as { mode?: string } | undefined
  if (settings?.mode !== 'advanced') return
  const rendererOrigin = `http://${ctx.webServer.host}:${ctx.webServer.port}`
  // `desktopProfiles` and `agents` are optional services in minimal/bare
  // contexts, so inject them guardedly instead of adding them to `inject`.
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['desktopProfiles', 'agents'], (childCtx) => {
    const profileDir = childCtx.desktopProfiles?.current.dir
    if (profileDir === undefined) return
    let ideServer: IdeServerHandle | undefined
    childCtx.effect(() => {
      const cfg = loadIdeConfig(profileDir)
      ideServer = startIdeServer({ ctx: childCtx, rendererOrigin, profileDir, allowedDirs: cfg.allowedDirs })
      // Persist the loopback endpoint the extensions should POST to: the
      // user-level file for the native VS Code bridge, plus the profile-level
      // file the embedded IDE writes next to its extensions dir.
      writeIdeBridgeConfig(profileDir, rendererOrigin, DESKTOP_IDE_ASK_PATH)
      writeEmbeddedIdeBridgeConfig(profileDir, rendererOrigin, DESKTOP_IDE_ASK_PATH)
      return () => { ideServer?.dispose(); ideServer = undefined }
    }, 'dsh-desktop-ide-bridge: ide server')
    childCtx.effect(() => childCtx.webServer.register({
      kind: 'exact',
      path: DESKTOP_IDE_INFO_PATH,
      handler: (req, res) => handleIdeInfoRequest(
        req, res, rendererOrigin,
        () => ideServer?.getInfo() ?? {
          url: null,
          mode: 'none',
          status: 'missing',
          detail: undefined,
          vscode: { found: false, path: null, version: null, extensionReady: false },
        },
      ),
    }), 'dsh-desktop-ide-bridge: ide info route')
    childCtx.effect(() => childCtx.webServer.register({
      kind: 'exact',
      path: DESKTOP_IDE_CONFIG_PATH,
      handler: (req, res) => void handleIdeConfigRequest(req, res, rendererOrigin, profileDir, () => ideServer),
    }), 'dsh-desktop-ide-bridge: ide config route')
    // Start the embedded IDE lazily when the panel opens.
    childCtx.effect(() => childCtx.webServer.register({
      kind: 'exact',
      path: DESKTOP_IDE_START_PATH,
      handler: (req, res) => handleIdeStartRequest(req, res, rendererOrigin, () => {
        void ideServer?.ensureStarted()
      }),
    }), 'dsh-desktop-ide-bridge: ide start route')
    // Launch the workspace in the user's native VS Code (external linkage).
    childCtx.effect(() => childCtx.webServer.register({
      kind: 'exact',
      path: DESKTOP_IDE_OPEN_PATH,
      handler: (req, res) => handleIdeOpenRequest(req, res, rendererOrigin, () => ideServer?.openInVSCode() ?? false),
    }), 'dsh-desktop-ide-bridge: ide open route')
    // Built-in lightweight IDE (file tree + CodeMirror editor). File access is
    // scoped to the profile dir plus the user-approved allowed directories.
    const ideRoots = (): string[] => [profileDir, ...loadIdeConfig(profileDir).allowedDirs]
    childCtx.effect(() => childCtx.webServer.register({
      kind: 'exact',
      path: DESKTOP_IDE_TREE_PATH,
      handler: (req, res) => handleIdeTreeRequest(req, res, rendererOrigin, ideRoots),
    }), 'dsh-desktop-ide-bridge: ide tree route')
    childCtx.effect(() => childCtx.webServer.register({
      kind: 'exact',
      path: DESKTOP_IDE_FILE_PATH,
      handler: (req, res) => handleIdeFileRequest(req, res, rendererOrigin, ideRoots),
    }), 'dsh-desktop-ide-bridge: ide file route')
    // Register the opened file's directory as a Host workspace so new
    // conversations start there. Read through `reflect.get(…, false)` so a
    // bare context without the workspace registry degrades to a no-op
    // instead of tripping the strict inject check.
    const ensureFileWorkspace = async (dir: string): Promise<void> => {
      const reflect = (childCtx as { reflect?: { get?(name: string, strict?: boolean): unknown } }).reflect
      const registry = reflect?.get?.('workspaceRegistry', false) as
        | { create?(path: string, title?: string): Promise<unknown> }
        | undefined
      if (registry === undefined || typeof registry.create !== 'function') return
      await registry.create(dir)
    }
    childCtx.effect(() => childCtx.webServer.register({
      kind: 'exact',
      path: DESKTOP_IDE_WORKSPACE_PATH,
      handler: (req, res) => void handleIdeWorkspaceRequest(req, res, rendererOrigin, ideRoots, ensureFileWorkspace),
    }), 'dsh-desktop-ide-bridge: ide workspace route')
    // Bridge: forward an editor selection (file + selected text) into the live
    // agent as a user message. Host-side injection — no browser plumbing needed.
    childCtx.effect(() => childCtx.webServer.register({
      kind: 'exact',
      path: DESKTOP_IDE_ASK_PATH,
      handler: (req, res) => void handleIdeAskRequest(req, res, rendererOrigin, childCtx),
    }), 'dsh-desktop-ide-bridge: ide ask route')
  })
}
