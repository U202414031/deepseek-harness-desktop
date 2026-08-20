/**
 * Desktop-owned whale-skin asset bridge.
 *
 * The sandboxed renderer window loads from `http://127.0.0.1:<port>` with
 * `webSecurity: true`, so `file:///...` asset URLs are rejected by Chromium
 * ("Not allowed to load local resource") — skins would silently lose their
 * video / backdrop / sprite images and look nothing like the HTML preview.
 *
 * Instead, this module registers a loopback *prefix* route
 * (`/desktop/skins/*`) that serves the whale-skins asset directory with the
 * correct MIME types and HTTP Range support (video seeking). Skin definitions
 * reference these assets as origin-relative paths (`/desktop/skins/...`), so
 * the renderer loads them same-origin and they behave identically to the
 * preview page.
 *
 * User-imported media (the "从图片 / 视频生成皮肤" flow) is stored under
 * `<root>/user-imports/<id>.<ext>` and served through the same prefix route.
 * A dedicated exact route `/desktop/skins/media` accepts raw uploads
 * (POST) and removes imported files again (DELETE) — the sandboxed renderer
 * cannot write to disk itself, so the Host owns the file lifecycle.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createReadStream, createWriteStream, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Root of the whale-girl skin assets (images, videos, sprite frames). */
const SKINS_ROOT = normalize('D:/deepseek/deepseek-desk/whale-skins')

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

/** Media types the image/video skin importer accepts (extensions, no dot). */
export const IMPORT_MEDIA_EXTS: readonly string[] = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm']

/** Hard cap for a single uploaded skin media file (large wallpapers / videos). */
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024

/**
 * Resolve a `/desktop/skins/...` pathname to a file inside `root`,
 * rejecting anything that escapes the root (path traversal) or is not a file.
 * @returns absolute file path, or null when not safe / not present.
 */
function resolveAsset(root: string, urlPath: string): string | null {
  const sub = decodeURIComponent(urlPath.replace(/^\/desktop\/skins\/?/, ''))
  if (sub.length === 0 || sub.includes('\0')) return null
  const full = normalize(join(root, sub))
  if (full !== root && !full.startsWith(root + sep)) return null
  try {
    if (!statSync(full).isFile()) return null
  } catch {
    return null
  }
  return full
}

/** Serve one asset with MIME + Range support. */
function serveAsset(req: IncomingMessage, res: ServerResponse, file: string): void {
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
  const type = MIME_BY_EXT[ext] ?? 'application/octet-stream'
  const size = statSync(file).size
  const range = req.headers.range
  if (typeof range === 'string' && /^bytes=\d*-\d*$/.test(range.trim())) {
    const [startRaw, endRaw] = range.trim().slice(6).split('-')
    const start = startRaw === '' ? undefined : Number(startRaw)
    const end = endRaw === '' ? undefined : Number(endRaw)
    let from = Number.isFinite(start as number) ? (start as number) : 0
    let to = Number.isFinite(end as number) ? (end as number) : size - 1
    if (startRaw === '' && endRaw !== '') {
      // suffix range: last N bytes
      from = Math.max(0, size - Number(endRaw))
      to = size - 1
    }
    if (from > to || from >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` })
      res.end()
      return
    }
    to = Math.min(to, size - 1)
    res.writeHead(206, {
      'content-type': type,
      'content-length': to - from + 1,
      'content-range': `bytes ${from}-${to}/${size}`,
      'accept-ranges': 'bytes',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    })
    createReadStream(file, { start: from, end: to }).pipe(res)
    return
  }
  res.writeHead(200, {
    'content-type': type,
    'content-length': size,
    'accept-ranges': 'bytes',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  })
  createReadStream(file).pipe(res)
}

/** Allow the sandboxed renderer to call the media import route. */
function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin
  res.setHeader('access-control-allow-origin', origin ?? '*')
  res.setHeader('access-control-allow-methods', 'POST, DELETE, OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type')
  res.setHeader('access-control-max-age', '600')
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: { ok: boolean; error?: string; url?: string; removed?: number },
): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

/** Media import id: short URL-safe token (never a path). */
export function isValidMediaId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,79}$/i.test(id)
}

/** @returns the canonical extension (lowercase) when the media type is importable, else null. */
export function normalizeImportExt(ext: string): string | null {
  const lower = ext.toLowerCase().replace(/^\./, '')
  if (lower === 'jpeg') return 'jpg'
  return IMPORT_MEDIA_EXTS.includes(lower) ? lower : null
}

/** Stream a request body into `file`, failing loudly past the byte cap. */
function receiveUpload(req: IncomingMessage, file: string, limit: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(file, { flags: 'wx' })
    let size = 0
    let failed = false
    const fail = (cause: unknown): void => {
      if (failed) return
      failed = true
      out.destroy()
      try { unlinkSync(file) } catch {
        // best-effort cleanup of the partial file
      }
      reject(cause instanceof Error ? cause : new Error(String(cause)))
    }
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        req.destroy()
        fail(new Error(`upload exceeds the ${limit}-byte import limit`))
        return
      }
      out.write(chunk)
    })
    req.on('error', fail)
    req.on('aborted', () => fail(new Error('upload aborted')))
    req.on('end', () => { out.end() })
    out.on('error', fail)
    out.on('finish', () => {
      if (!failed) resolve()
    })
  })
}

/** Handle POST / DELETE on the exact `/desktop/skins/media` route. */
function makeMediaHandler(root: string) {
  const importsDir = join(root, 'user-imports')
  return (req: IncomingMessage, res: ServerResponse): void => {
    void handle(req, res)
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    applyCors(req, res)
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const id = url.searchParams.get('id') ?? ''
    if (!isValidMediaId(id)) {
      sendJson(res, 400, { ok: false, error: 'invalid media id' })
      return
    }
    if (req.method === 'POST') {
      const ext = normalizeImportExt(url.searchParams.get('ext') ?? '')
      if (ext === null) {
        sendJson(res, 400, { ok: false, error: 'unsupported media type' })
        return
      }
      const file = join(importsDir, `${id}.${ext}`)
      try {
        mkdirSync(importsDir, { recursive: true })
        await receiveUpload(req, file, MAX_UPLOAD_BYTES)
        sendJson(res, 200, { ok: true, url: `/desktop/skins/user-imports/${id}.${ext}` })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        sendJson(res, 400, { ok: false, error: message })
      }
      return
    }
    if (req.method === 'DELETE') {
      try {
        let removed = 0
        for (const name of readdirSafe(importsDir)) {
          if (name.startsWith(`${id}.`)) {
            try {
              unlinkSync(join(importsDir, name))
              removed++
            } catch {
              // keep going; the file may already be gone
            }
          }
        }
        sendJson(res, 200, { ok: true, removed })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        sendJson(res, 500, { ok: false, error: message })
      }
      return
    }
    sendJson(res, 405, { ok: false, error: `method ${req.method ?? '?'} not allowed` })
  }
}

/** readdirSync that treats a missing directory as empty. */
function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * Register the whale-skin asset routes: the `/desktop/skins/*` prefix for
 * serving files plus the exact `/desktop/skins/media` route for importing and
 * deleting user media. `options.root` lets tests point at a temp directory.
 * @returns the combined route disposer.
 */
export function installSkinsRoutes(ctx: Context, options: { root?: string } = {}): () => void {
  const root = normalize(options.root ?? SKINS_ROOT)
  const assetDisposer = ctx.webServer.register({
    kind: 'prefix',
    path: '/desktop/skins',
    handler: (req: IncomingMessage, res: ServerResponse): void => {
      const urlPath = (req.url ?? '').split('?')[0]!
      const file = resolveAsset(root, urlPath)
      if (file === null) {
        res.statusCode = 404
        res.setHeader('content-type', 'text/plain; charset=utf-8')
        res.end('not found')
        return
      }
      serveAsset(req, res, file)
    },
  })
  const mediaDisposer = ctx.webServer.register({
    kind: 'exact',
    path: '/desktop/skins/media',
    handler: makeMediaHandler(root),
  })
  return () => {
    assetDisposer()
    mediaDisposer()
  }
}
