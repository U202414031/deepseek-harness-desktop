/**
 * Embedded IDE host.
 *
 * Two surfaces share one handle:
 *
 *  - **Embedded** (primary): a locally served openvscode-server instance —
 *    browser VS Code — running on a random loopback port, rendered by the
 *    client in the right IDE panel via an iframe. The server is started lazily
 *    by `ensureStarted()` (triggered by the panel's start route) so it does not
 *    consume memory while the panel stays closed. The agent and the IDE share
 *    the same disk: agent edits appear in the editor immediately, and the
 *    dsh-ide-bridge extension installed into the IDE forwards "select → ask"
 *    back over the loopback ask route.
 *
 *  - **Linkage** (fallback / escape hatch): the original external-VS Code mode —
 *    writes a multi-root `.code-workspace` seeded with the profile directory
 *    plus the user-approved folders and launches the user's installed VS Code
 *    as a DETACHED process (the editor is the user's own application and must
 *    outlive this app).
 *
 * The embedded runtime is resolved from, in order: the `DSH_OPENVSCODE_SERVER_PATH`
 * env override, the packaged `resources/code-server/openvscode-server` folder,
 * then the repo's `tools/code-server/openvscode-server` in local development.
 * When it is absent the app degrades to the linkage surface and the panel says
 * so (see `scripts/fetch-openvscode-server.mjs` to obtain the release).
 */

import { type Context } from '@deepseek-ai/cordis'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer, get as httpGet } from 'node:http'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { isAbsolute, join } from 'node:path'
import type { DesktopIdeInfoResponse } from './ide-info-contract.ts'
import { DESKTOP_IDE_ASK_PATH } from './ide-info-contract.ts'

/** Options for {@link startIdeServer}. */
export interface IdeServerOptions {
  /** Active host Cordis context. */
  ctx: Context
  /** Renderer origin (used as the ask-bridge base URL for the IDE extension). */
  rendererOrigin: string
  /** Active profile directory; opened as the primary IDE workspace folder. */
  profileDir: string
  /** User-approved extra directories exposed to the IDE as workspace folders. */
  allowedDirs: string[]
}

/** Long-lived handle returned by {@link startIdeServer}. */
export interface IdeServerHandle {
  /** Release app-owned resources (never touches an external VS Code window). */
  dispose(): void
  /** Loopback URL of the embedded IDE, or null while it is not running. */
  getUrl(): string | null
  /** Snapshot for the info route (embedded status + VS Code linkage state). */
  getInfo(): DesktopIdeInfoResponse
  /** Replace allowed directories and rewrite the workspace file. */
  updateAllowedDirs(dirs: string[]): void
  /** Launch the workspace in the user's VS Code (external linkage). */
  openInVSCode(): boolean
  /**
   * Start the embedded openvscode-server if it is not already running or
   * booting. Safe to call repeatedly; failures move the status to `error`
   * (a later call retries).
   */
  ensureStarted(): Promise<void>
}

/** Sub-directory (inside `tools/code-server` / `resources/code-server`) of the runtime. */
const EMBEDDED_SUBDIR = 'openvscode-server'

/** App-owned state directory inside the profile dir for the embedded IDE. */
const EMBEDDED_STATE_DIR = '.dsh-ide'

/** Folder the bridge extension is copied into, inside the extensions dir. */
const BRIDGE_EXTENSION_DIR = 'dsh-ide-bridge'

/** How long to wait for the embedded server's HTTP endpoint before failing. */
const START_TIMEOUT_MS = 45_000

/** How often the readiness probe polls the embedded server. */
const PROBE_INTERVAL_MS = 250

/** Candidate locations for the VS Code executable, most specific first. */
function vscodeCandidates(): string[] {
  const list: string[] = []
  const env = process.env.DSH_VSCODE_PATH
  if (env !== undefined && env.length > 0) list.push(env)
  if (process.env.LOCALAPPDATA !== undefined) {
    list.push(join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'))
  }
  if (process.env.PROGRAMFILES !== undefined) {
    list.push(join(process.env.PROGRAMFILES, 'Microsoft VS Code', 'Code.exe'))
  }
  if (process.env['PROGRAMFILES(X86)'] !== undefined) {
    list.push(join(process.env['PROGRAMFILES(X86)'], 'Microsoft VS Code', 'Code.exe'))
  }
  list.push(join(homedir(), 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'Code.exe'))
  // The user's machine keeps VS Code on D: — cover the common alternative too.
  list.push('D:/Microsoft VS Code/Code.exe')
  return [...new Set(list)]
}

/** Resolve the VS Code executable, or null when not found. */
function resolveVSCode(): string | null {
  for (const candidate of vscodeCandidates()) {
    if (candidate.length > 0 && existsSync(candidate)) return candidate
  }
  return null
}

/** VS Code extension directory (default per-user location). */
function vscodeExtensionsDir(): string {
  return join(homedir(), '.vscode', 'extensions')
}

/** Build the folder list: profile dir first, then the user-approved directories. */
function computeFolders(profileDir: string, allowedDirs: string[]): string[] {
  const extra = allowedDirs.filter(dir => dir && isAbsolute(dir) && existsSync(dir))
  const set = new Set<string>([profileDir, ...extra])
  return [...set]
}

/** Write a multi-root .code-workspace file pointing at the chosen folders. */
function writeWorkspaceFile(profileDir: string, folders: string[]): string {
  const payload = { folders: folders.map(path => ({ path })), settings: {} }
  const file = join(profileDir, '.dsh-ide.code-workspace')
  writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')
  return file
}

/**
 * Resolve the bundled openvscode-server release root, or null when absent.
 * Order: `DSH_OPENVSCODE_SERVER_PATH` env override → packaged
 * `resources/code-server/openvscode-server` → repo `tools/code-server/openvscode-server`.
 * A root only counts when it looks like a release (bin launcher or node binary).
 */
export function resolveEmbeddedServerRoot(): string | null {
  const candidates: string[] = []
  const env = process.env.DSH_OPENVSCODE_SERVER_PATH
  if (env !== undefined && env.length > 0) candidates.push(env)
  const resources = (process as unknown as { resourcesPath?: string }).resourcesPath
  if (resources !== undefined) {
    candidates.push(join(resources, 'code-server', EMBEDDED_SUBDIR))
  }
  candidates.push(fileURLToPath(new URL('../tools/code-server/openvscode-server', import.meta.url)))
  for (const candidate of candidates) {
    if (!existsSync(join(candidate, 'package.json'))) continue
    // A release counts when it ships a bundled node, a platform launcher, or
    // at least the server main entry (npm-installed layouts have the last one).
    if (
      resolveNodeBinary(candidate) !== null
      || resolveLauncher(candidate) !== null
      || resolveServerMain(candidate) !== null
    ) return candidate
  }
  return null
}

/** Absolute path of the node binary bundled with the release, or null. */
function resolveNodeBinary(root: string): string | null {
  const name = process.platform === 'win32' ? 'node.exe' : 'node'
  const candidate = join(root, name)
  return existsSync(candidate) ? candidate : null
}

/** Absolute path of the platform launcher script shipped with the release, or null. */
function resolveLauncher(root: string): string | null {
  const name = process.platform === 'win32' ? 'openvscode-server.cmd' : 'openvscode-server'
  const candidate = join(root, 'bin', name)
  return existsSync(candidate) ? candidate : null
}

/**
 * Resolve the openvscode-server main entry (`out/server-main.js`) inside a
 * release root, or null when the layout is unexpected.
 */
function resolveServerMain(root: string): string | null {
  const candidate = join(root, 'out', 'server-main.js')
  return existsSync(candidate) ? candidate : null
}

/** Pick a currently-free TCP port on the loopback interface. */
export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

/** Full CLI argument list for the embedded server. */
export function buildEmbeddedArgs(options: {
  serverMain: string
  port: number
  profileDir: string
  extensionsDir: string
  userDataDir: string
}): string[] {
  return [
    options.serverMain,
    '--host', '127.0.0.1',
    '--port', String(options.port),
    '--without-connection-token',
    '--extensions-dir', options.extensionsDir,
    '--user-data-dir', options.userDataDir,
    '--default-folder', options.profileDir,
    '--disable-telemetry',
  ]
}

/**
 * Minimal fallback argument list used when the full list is rejected by an
 * older CLI (unknown-option startup failure). Kept to flags every
 * openvscode-server release understands.
 */
function buildMinimalEmbeddedArgs(options: {
  serverMain: string
  port: number
  extensionsDir: string
  userDataDir: string
}): string[] {
  return [
    options.serverMain,
    '--host', '127.0.0.1',
    '--port', String(options.port),
    '--without-connection-token',
    '--extensions-dir', options.extensionsDir,
    '--user-data-dir', options.userDataDir,
  ]
}

/** Wait until `url` answers HTTP 200, or fail after `timeoutMs`. */
export function waitForHttp(url: string, timeoutMs: number, intervalMs = PROBE_INTERVAL_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const attempt = (): void => {
      const req = httpGet(url, (res) => {
        res.resume()
        if (res.statusCode === 200) {
          resolve(true)
          return
        }
        schedule()
      })
      req.on('error', () => schedule())
      req.setTimeout(2_000, () => {
        req.destroy()
        schedule()
      })
      function schedule(): void {
        if (Date.now() >= deadline) {
          resolve(false)
          return
        }
        setTimeout(attempt, intervalMs)
      }
    }
    attempt()
  })
}

/**
 * Resolve the bridge extension source folder (the dsh-ide-bridge VS Code
 * extension) in order: `DSH_IDE_EXTENSION_PATH` env override, packaged
 * `resources/code-server/ide-extension`, then the repo's `ide-extension/`.
 * Returns null when none is present.
 */
export function resolveBridgeExtensionSource(): string | null {
  const env = process.env.DSH_IDE_EXTENSION_PATH
  if (env !== undefined && existsSync(join(env, 'package.json'))) return env
  const resources = (process as unknown as { resourcesPath?: string }).resourcesPath
  if (resources !== undefined) {
    const packed = join(resources, 'code-server', 'ide-extension')
    if (existsSync(join(packed, 'package.json'))) return packed
  }
  const dev = fileURLToPath(new URL('../ide-extension', import.meta.url))
  if (existsSync(join(dev, 'package.json'))) return dev
  return null
}

/**
 * Copy the bridge extension into an extensions directory (skipped when the
 * destination is newer or equal). The embedded IDE receives its own copy inside
 * the profile state dir; the external VS Code receives the per-user copy.
 * @returns true when the extension is present and up to date (or already so).
 */
export function ensureIdeExtensionCopy(ctx: Context, extensionsDir: string): boolean {
  const source = resolveBridgeExtensionSource()
  if (source === null) return false
  const target = join(extensionsDir, BRIDGE_EXTENSION_DIR)
  const srcPkg = join(source, 'package.json')
  const dstPkg = join(target, 'package.json')
  try {
    if (existsSync(dstPkg) && statSync(srcPkg).mtimeMs <= statSync(dstPkg).mtimeMs) return true
    mkdirSync(target, { recursive: true })
    cpSync(source, target, { recursive: true, force: true, dereference: true })
    ctx.logger.info(`dsh-plugin-desktop: IDE bridge extension ready at ${target}`)
    return true
  } catch (cause) {
    ctx.logger.warn(`dsh-plugin-desktop: failed to sync IDE bridge extension: ${String(cause)}`)
    return false
  }
}

/** Write the ask-bridge config file an extension host reads. */
function writeBridgeConfigFile(file: string, baseUrl: string, askPath: string): void {
  const payload = JSON.stringify({ baseUrl, askPath }, null, 2)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, payload, 'utf8')
}

/** Kill a spawned server process tree (taskkill on Windows, process group otherwise). */
function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      child.kill()
    }
    return
  }
  try {
    // Detached children are their own process-group leaders; signal the group.
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try { child.kill() } catch { /* already gone */ }
  }
}

/**
 * Wait until the embedded server answers HTTP 200, its process exits, or the
 * timeout elapses — whichever comes first. An early exit (e.g. an unknown CLI
 * flag) fails fast instead of letting the probe run to the full timeout.
 */
function waitForReady(port: number, child: ChildProcess, timeoutMs: number): Promise<'ready' | 'exited' | 'timeout'> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (value: 'ready' | 'exited' | 'timeout'): void => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }
    child.once('exit', () => settle('exited'))
    void waitForHttp(`http://127.0.0.1:${port}/`, timeoutMs).then(ok => settle(ok ? 'ready' : 'timeout'))
  })
}

/** Lifecycle state of the embedded server. */
type EmbeddedState =
  | { kind: 'stopped' }
  | { kind: 'starting'; port: number }
  | { kind: 'ready'; port: number }
  | { kind: 'error'; detail: string }

/**
 * Start (and manage) the embedded IDE. The openvscode-server process is spawned
 * lazily by {@link IdeServerHandle.ensureStarted}; the external VS Code linkage
 * is always available as a fallback.
 * @param options - profile, origin, and allowed directories.
 * @returns a handle for status, disposal, and directory updates.
 */
export function startIdeServer(options: IdeServerOptions): IdeServerHandle {
  const { ctx, profileDir, rendererOrigin, allowedDirs } = options
  const embeddedRoot = resolveEmbeddedServerRoot()
  const binary = resolveVSCode()
  const extensionReady = binary !== null
    ? ensureIdeExtensionCopy(ctx, vscodeExtensionsDir())
    : false
  let folders = computeFolders(profileDir, allowedDirs)
  let state: EmbeddedState = { kind: 'stopped' }
  let child: ChildProcess | undefined
  let stderrTail: string[] = []

  const drainStderr = (chunk: Buffer): void => {
    stderrTail = [...stderrTail, chunk.toString('utf8')].slice(-20)
  }

  const spawnAttempt = (
    args: string[],
    env: NodeJS.ProcessEnv,
  ): ChildProcess | null => {
    const root = embeddedRoot
    if (root === null) return null
    const node = resolveNodeBinary(root)
    const serverMain = resolveServerMain(root)
    if (node !== null && serverMain !== null) {
      return spawn(node, args, {
        cwd: root,
        env,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    }
    const launcher = resolveLauncher(root)
    if (launcher !== null) {
      // Windows .cmd launchers need a shell; unix launchers are scripts.
      return spawn(launcher, args, {
        cwd: root,
        env,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      })
    }
    // No bundled node or launcher (e.g. an npm-installed openvscode-server
    // layout): run the main entry with the app's own Node runtime.
    if (serverMain !== null) {
      return spawn(process.execPath, args, {
        cwd: root,
        env,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    }
    return null
  }

  /**
   * Spawn the embedded server and wait for it to answer HTTP 200. Updates
   * `state` on success ('ready') or failure ('error' with a diagnostic).
   */
  const startServer = async (): Promise<void> => {
    const root = embeddedRoot
    if (root === null) {
      state = { kind: 'error', detail: '未找到内嵌 IDE 运行时（openvscode-server）' }
      return
    }
    const extensionsDir = join(profileDir, EMBEDDED_STATE_DIR, 'extensions')
    const userDataDir = join(profileDir, EMBEDDED_STATE_DIR, 'user-data')
    mkdirSync(extensionsDir, { recursive: true })
    if (!ensureIdeExtensionCopy(ctx, extensionsDir)) {
      ctx.logger.warn('dsh-plugin-desktop: embedded IDE started without the bridge extension')
    }
    const bridgeFile = join(profileDir, EMBEDDED_STATE_DIR, '.dsh-ide-bridge.json')
    writeBridgeConfigFile(bridgeFile, rendererOrigin, DESKTOP_IDE_ASK_PATH)
    const env: NodeJS.ProcessEnv = { ...process.env, DSH_IDE_BRIDGE_PATH: bridgeFile }
    const serverMain = resolveServerMain(root)
    if (serverMain === null) {
      state = { kind: 'error', detail: '内嵌 IDE 运行时结构不完整（缺少 out/server-main.js）' }
      return
    }

    for (const attempt of [1, 2] as const) {
      // Re-pick per attempt so a port race cannot poison the retry.
      const port = await pickFreePort()
      state = { kind: 'starting', port }
      const args = attempt === 1
        ? buildEmbeddedArgs({ serverMain, port, profileDir, extensionsDir, userDataDir })
        : buildMinimalEmbeddedArgs({ serverMain, port, extensionsDir, userDataDir })
      stderrTail = []
      const spawned = spawnAttempt(args, env)
      if (spawned === null) {
        state = { kind: 'error', detail: '内嵌 IDE 运行时不可执行（缺少 node 与启动脚本）' }
        return
      }
      child = spawned
      let exitCode: number | null = null
      spawned.on('exit', (code) => {
        exitCode = code
      })
      spawned.stderr?.on('data', drainStderr)
      spawned.stdout?.on('data', () => { /* drained so the pipe never blocks */ })
      const outcome = await waitForReady(port, spawned, START_TIMEOUT_MS)
      if (outcome === 'ready') {
        ctx.logger.info(`dsh-plugin-desktop: embedded IDE ready at http://127.0.0.1:${port}/`)
        state = { kind: 'ready', port }
        return
      }
      const detail = outcome === 'exited'
        ? `内嵌 IDE 进程提前退出（exit=${String(exitCode)}）：${stderrTail.join('').trim() || '无输出'}`
        : `内嵌 IDE 启动超时（${Math.round(START_TIMEOUT_MS / 1000)}s 未就绪）`
      killProcessTree(spawned)
      child = undefined
      if (attempt === 1) {
        ctx.logger.warn(`dsh-plugin-desktop: embedded IDE attempt 1 failed (${detail}); retrying with minimal flags`)
        continue
      }
      state = { kind: 'error', detail }
      return
    }
    state = { kind: 'error', detail: '内嵌 IDE 启动失败' }
  }

  const handle: IdeServerHandle = {
    dispose() {
      if (child !== undefined) killProcessTree(child)
      child = undefined
      state = { kind: 'stopped' }
    },
    getUrl() {
      return state.kind === 'ready' ? `http://127.0.0.1:${state.port}/` : null
    },
    async ensureStarted() {
      if (state.kind === 'starting' || state.kind === 'ready') return
      if (embeddedRoot === null) return
      await startServer()
    },
    getInfo(): DesktopIdeInfoResponse {
      const found = binary !== null
      const mode = embeddedRoot !== null ? 'embedded' : 'external'
      const url = state.kind === 'ready' ? `http://127.0.0.1:${state.port}/` : null
      let status: DesktopIdeInfoResponse['status']
      let detail: string | undefined
      switch (state.kind) {
        case 'ready':
          status = 'ready'
          break
        case 'starting':
          status = 'starting'
          break
        case 'error':
          status = 'error'
          detail = state.detail
          break
        case 'stopped':
          status = embeddedRoot !== null ? 'stopped' : 'missing'
          if (embeddedRoot === null) {
            detail = '未检测到内嵌 IDE 运行时（openvscode-server）。请先获取运行时（见 tools/code-server/README.md 或运行 `yarn ide:fetch`），或改用本机 VS Code 联动。'
          }
          break
      }
      return {
        url,
        mode,
        status,
        detail,
        vscode: {
          found,
          path: binary,
          version: null,
          extensionReady,
        },
      }
    },
    updateAllowedDirs(dirs: string[]) {
      folders = computeFolders(profileDir, dirs)
      writeWorkspaceFile(profileDir, folders)
    },
    openInVSCode(): boolean {
      if (binary === null) return false
      const workspaceFile = writeWorkspaceFile(profileDir, folders)
      try {
        // Detached + unref: the editor is the user's own window and must keep
        // running independently of this app (no managed subprocess, no kill).
        const spawned = spawn(binary, ['--reuse-window', workspaceFile], {
          cwd: profileDir,
          detached: true,
          stdio: 'ignore',
        })
        spawned.unref()
        ctx.logger.info(`dsh-plugin-desktop: opening workspace in VS Code: ${workspaceFile}`)
        return true
      } catch (cause) {
        ctx.logger.warn(`dsh-plugin-desktop: failed to launch VS Code: ${String(cause)}`)
        return false
      }
    },
  }
  return handle
}
