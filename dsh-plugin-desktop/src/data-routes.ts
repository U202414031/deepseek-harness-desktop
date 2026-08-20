/**
 * Desktop-owned data-root routes.
 *
 * The sandboxed renderer cannot reach Node or the launcher's process
 * environment, so the settings surface reads the live data-root state and
 * persists a new `dsh-desktop.dataDir` value through these loopback routes.
 *
 * The persisted value is a *startup* setting: the launcher applies it before
 * any data access on the next generation. `DSH_DESKTOP_DATA_DIR` (environment)
 * takes priority over the persisted value when both are present.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { parseDocument } from 'yaml'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  DESKTOP_SETTINGS_NAMESPACE,
  deriveDataDirs,
  readSettingsDocumentFromHome,
  resolveDesktopDataRoot,
} from './data-root.ts'

/** Loopback route returning the live data-root state. */
export const DATA_ROOT_INFO_PATH = '/desktop/data-root/info'

/** Loopback route persisting a new `dsh-desktop.dataDir` value. */
export const DATA_ROOT_UPDATE_PATH = '/desktop/data-root'

/** Register both data-root routes. @returns disposer removing both. */
export function installDataRootRoutes(ctx: Context): () => void {
  const disposers = [
    ctx.webServer.register({ kind: 'exact', path: DATA_ROOT_INFO_PATH, handler: (req, res) => { handleInfo(req, res) } }),
    ctx.webServer.register({ kind: 'exact', path: DATA_ROOT_UPDATE_PATH, handler: (req, res) => { void handleUpdate(req, res) } }),
  ]
  return () => { for (const dispose of disposers) dispose() }
}

/** Allow the sandboxed renderer to call these loopback routes. */
function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin
  res.setHeader('access-control-allow-origin', origin ?? '*')
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type')
  res.setHeader('access-control-max-age', '600')
}

/** Read a JSON request body with a hard size cap. */
function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let size = 0
    let data = ''
    req.setEncoding('utf8')
    req.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        req.destroy()
        reject(new Error('request body exceeded size limit'))
        return
      }
      data += chunk
    })
    req.on('end', () => resolvePromise(data))
    req.on('error', reject)
  })
}

interface RouteResponse {
  ok: boolean
  error?: string
  message?: string
  root?: string | null
  source?: 'env' | 'settings' | 'none'
  dirs?: {
    dshHome: string
    agentsHome: string
    dropboxDir: string
    desktopUserData: string
    auxDir: string
  } | null
}

function sendJson(res: ServerResponse, status: number, body: RouteResponse): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

/** Report the live data-root state (root, provenance, derived subdirectories). */
function handleInfo(req: IncomingMessage, res: ServerResponse): void {
  applyCors(req, res)
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  const dataRoot = resolveDesktopDataRoot(process.env, readSettingsDocumentFromHome(resolveDshHome()))
  sendJson(res, 200, {
    ok: true,
    root: dataRoot.root ?? null,
    source: dataRoot.source,
    dirs: dataRoot.root === undefined ? null : deriveDataDirs(dataRoot.root),
  })
}

/** Persist a new `dsh-desktop.dataDir` into the DSH home settings document. */
async function handleUpdate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  applyCors(req, res)
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  try {
    const raw = await readBody(req)
    const parsed = JSON.parse(raw) as { dir?: unknown }
    const dir = parsed.dir
    if (typeof dir !== 'string' || dir.trim().length === 0) {
      throw new Error('数据目录不能为空')
    }
    if (dir.length > 1000) {
      throw new Error('数据目录路径过长')
    }
    if (!isAbsolute(dir)) {
      throw new Error('请填写绝对路径（例如 D:/MyData/desktop-data）')
    }
    const normalized = resolve(dir.trim())
    const home = resolveDshHome()
    const settingsPath = `${home}/settings.yaml`
    let text = ''
    try {
      text = readFileSync(settingsPath, 'utf8')
    } catch {
      text = ''
    }
    const document = parseDocument(
      text.length > 0 ? text : `# DeepSeek Harness Desktop settings\n${DESKTOP_SETTINGS_NAMESPACE}: {}\n`,
      { prettyErrors: true },
    )
    if (document.errors.length > 0) {
      throw new Error('settings.yaml 解析失败，请检查文件格式')
    }
    document.setIn([DESKTOP_SETTINGS_NAMESPACE, 'dataDir'], normalized)
    mkdirSync(dirname(settingsPath), { recursive: true })
    writeFileSync(settingsPath, document.toString(), 'utf8')
    sendJson(res, 200, { ok: true, message: '已保存，重启桌面端后生效' })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    sendJson(res, 400, { ok: false, error: message })
  }
}
