/**
 * Embedded IDE linkage host: instead of spawning a web IDE (code-server has no
 * official Windows build, and VS Code's `serve-web` component downloads from a
 * CDN that is unreachable on some networks), this module links the desktop app
 * to the user's natively installed VS Code:
 *
 *  - detects `Code.exe` on the machine (env override > common install paths);
 *  - syncs the selection-bridge extension into VS Code's extension directory
 *    (`~/.vscode/extensions/dsh-ide-bridge`) so "select code → ask the AI"
 *    works inside the real editor;
 *  - writes a multi-root `.code-workspace` seeded with the profile directory
 *    plus the user-approved folders;
 *  - `openInVSCode()` launches the workspace in VS Code as a DETACHED process —
 *    the editor is the user's own application and must outlive this app.
 *
 * The agent and VS Code share the same disk: when the agent edits a file it
 * appears in the editor immediately, and the bridge extension opens an inline
 * diff for "modify" requests.
 */

import { type Context } from '@deepseek-ai/cordis'
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { isAbsolute, join } from 'node:path'
import type { DesktopIdeInfoResponse } from './ide-info-contract.ts'

/** Options for {@link startIdeServer}. */
export interface IdeServerOptions {
  /** Active host Cordis context. */
  ctx: Context
  /** Renderer origin (kept for the bridge contract; VS Code opens natively). */
  rendererOrigin: string
  /** Active profile directory; opened as the primary IDE workspace folder. */
  profileDir: string
  /** User-approved extra directories exposed to the IDE as workspace folders. */
  allowedDirs: string[]
}

/** Long-lived handle returned by {@link startIdeServer}. */
export interface IdeServerHandle {
  /** Release app-owned resources (never touches the external VS Code window). */
  dispose(): void
  /** Always null in linkage mode; kept for contract compatibility. */
  getUrl(): string | null
  /** Snapshot for the info route (VS Code detection + extension state). */
  getInfo(): DesktopIdeInfoResponse
  /** Replace allowed directories and rewrite the workspace file. */
  updateAllowedDirs(dirs: string[]): void
  /** Launch the workspace in the user's VS Code. */
  openInVSCode(): boolean
}

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
 * Sync the bundled bridge extension into VS Code's extension directory so
 * "select code → ask the AI" works inside the native editor. Source order:
 * `DSH_IDE_EXTENSION_PATH` env override, packaged
 * `resources/code-server/ide-extension`, then the repo's `ide-extension/`
 * folder in local development. Skipped when the destination is newer or equal.
 * @returns true when the extension is present and up to date.
 */
function ensureIdeExtension(ctx: Context, extensionsDir: string): boolean {
  let source: string | undefined
  const env = process.env.DSH_IDE_EXTENSION_PATH
  if (env !== undefined && existsSync(join(env, 'package.json'))) source = env
  if (source === undefined) {
    const resources = (process as unknown as { resourcesPath?: string }).resourcesPath
    if (resources !== undefined) {
      const packed = join(resources, 'code-server', 'ide-extension')
      if (existsSync(join(packed, 'package.json'))) source = packed
    }
  }
  if (source === undefined) {
    const dev = fileURLToPath(new URL('../ide-extension', import.meta.url))
    if (existsSync(join(dev, 'package.json'))) source = dev
  }
  if (source === undefined) return false
  const target = join(extensionsDir, 'dsh-ide-bridge')
  const srcPkg = join(source, 'package.json')
  const dstPkg = join(target, 'package.json')
  try {
    if (existsSync(dstPkg) && statSync(srcPkg).mtimeMs <= statSync(dstPkg).mtimeMs) return true
    mkdirSync(target, { recursive: true })
    cpSync(source, target, { recursive: true, force: true, dereference: true })
    ctx.logger.info(`dsh-plugin-desktop: VS Code bridge extension ready at ${target}`)
    return true
  } catch (cause) {
    ctx.logger.warn(`dsh-plugin-desktop: failed to sync IDE bridge extension: ${String(cause)}`)
    return false
  }
}

/**
 * Start (and manage) the VS Code linkage for the embedded IDE panel.
 * @param options - profile, origin, and allowed directories.
 * @returns a handle for status, disposal, and directory updates.
 */
export function startIdeServer(options: IdeServerOptions): IdeServerHandle {
  const { ctx, profileDir, allowedDirs } = options
  const binary = resolveVSCode()
  const extensionReady = binary !== null
    ? ensureIdeExtension(ctx, vscodeExtensionsDir())
    : false
  let folders = computeFolders(profileDir, allowedDirs)
  let version: string | null = null

  const status: DesktopIdeInfoResponse['status'] = binary === null ? 'missing' : 'ready'
  const detail: string | undefined = binary === null
    ? '未检测到 VS Code。请先安装 Visual Studio Code（https://code.visualstudio.com），或用环境变量 DSH_VSCODE_PATH 指定 Code.exe 的路径，然后重启应用。'
    : undefined

  const handle: IdeServerHandle = {
    dispose() {
      // Nothing app-owned to release: the editor is the user's external VS Code.
    },
    getUrl() {
      return null
    },
    getInfo(): DesktopIdeInfoResponse {
      const found = binary !== null
      return {
        url: null,
        status,
        detail,
        vscode: {
          found,
          path: binary,
          version,
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
        const child = spawn(binary, ['--reuse-window', workspaceFile], {
          cwd: profileDir,
          detached: true,
          stdio: 'ignore',
        })
        child.unref()
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
