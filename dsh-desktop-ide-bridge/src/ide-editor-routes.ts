/**
 * Host routes for the built-in lightweight IDE (file tree + read/write).
 *
 * Security model: every requested path is resolved against the *allowed roots*
 * (the active profile directory plus the user-approved `allowedDirs`). The
 * resolution canonicalizes the path (symlinks included, via realpath of the
 * deepest existing ancestor) and rejects anything that lands outside a root,
 * so the panel can never read or write arbitrary locations on disk.
 *
 * All routes reuse the same origin policy as the other IDE routes
 * (`originAllowed` + `enforceOrigin`), including CORS for loopback callers.
 */

import { mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DesktopIdeFileResponse, DesktopIdeFileWrite, DesktopIdeTreeResponse } from './ide-editor-contract.ts'
import { languageFromPath } from './ide-editor-contract.ts'
import { enforceOrigin, handleOptions } from './ide-routes.ts'

/** Largest file the editor will read (1 MiB). */
const MAX_READ_SIZE = 1_000_000

/** Largest file the editor will write (2 MiB). */
const MAX_WRITE_SIZE = 2_000_000

function finishJson(res: ServerResponse, statusCode: number, value: object): void {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(value))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_WRITE_SIZE + 1_024) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Normalize a root for prefix comparison. Roots must exist; missing roots are
 * dropped so they never widen the allow-list.
 */
function normalizeRoot(root: string): string | null {
  try {
    return resolve(realpathSync(root))
  } catch {
    return null
  }
}

/** Case-insensitive prefix check (paths are already resolved). */
function isWithin(candidate: string, root: string): boolean {
  const left = process.platform === 'win32' ? candidate.toLowerCase() : candidate
  const right = process.platform === 'win32' ? root.toLowerCase() : root
  return left === right || left.startsWith(right.endsWith(sep) ? right : right + sep)
}

/**
 * Canonicalize `requested` and verify it stays inside one of the allowed
 * roots. Symlinks are resolved through the deepest existing ancestor, so a
 * link pointing outside the roots is rejected. Returns the canonical absolute
 * path, or null when the path is outside / malformed.
 */
export function resolveAllowedPath(roots: string[], requested: string): string | null {
  if (typeof requested !== 'string' || requested.length === 0) return null
  const normalizedRoots = roots
    .map(normalizeRoot)
    .filter((root): root is string => root !== null)
  if (normalizedRoots.length === 0) return null

  const absolute = resolve(requested)
  // Walk up to the deepest existing ancestor so symlinks in the path are
  // resolved; the non-existing tail is re-joined after canonicalization.
  let existing = absolute
  const tail: string[] = []
  while (true) {
    try {
      statSync(existing)
      break
    } catch {
      const parent = dirname(existing)
      if (parent === existing) return null
      tail.unshift(basename(existing))
      existing = parent
    }
  }
  const canonical = join(realpathSync(existing), ...tail)
  for (const root of normalizedRoots) {
    if (isWithin(canonical, root)) return canonical
  }
  return null
}

/**
 * Serve the workspace roots (no `path` query) or one directory listing.
 * @param getRoots - supplies the current allowed roots (profile dir first).
 */
export function handleIdeTreeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  getRoots: () => string[],
): void {
  if (req.method === 'OPTIONS') return handleOptions(res, req, expectedOrigin)
  if (req.method !== 'GET') return finishJson(res, 405, { error: 'method not allowed' })
  if (!enforceOrigin(res, req, expectedOrigin)) return finishJson(res, 403, { error: 'forbidden' })

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
  const requested = url.searchParams.get('path')

  if (requested === null) {
    const roots = getRoots()
      .map(normalizeRoot)
      .filter((root): root is string => root !== null)
    const unique = [...new Set(roots)]
    const response: DesktopIdeTreeResponse = {
      roots: unique.map(path => ({ name: basename(path) || path, path })),
    }
    finishJson(res, 200, response)
    return
  }

  const canonical = resolveAllowedPath(getRoots(), requested)
  if (canonical === null) return finishJson(res, 403, { error: 'path outside allowed roots' })
  let stat
  try {
    stat = statSync(canonical)
  } catch {
    return finishJson(res, 404, { error: 'not found' })
  }
  if (!stat.isDirectory()) return finishJson(res, 400, { error: 'not a directory' })

  let names: string[]
  try {
    names = readdirSync(canonical)
  } catch {
    return finishJson(res, 500, { error: 'read failed' })
  }
  const entries: DesktopIdeTreeResponse['entries'] = []
  for (const name of names) {
    if (name.startsWith('.')) continue // skip dotfiles for a tidy tree
    const child = join(canonical, name)
    let type: 'file' | 'dir'
    try {
      type = statSync(child).isDirectory() ? 'dir' : 'file'
    } catch {
      continue // dangling entries are skipped
    }
    entries.push({ name, path: child, type })
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
  finishJson(res, 200, { entries })
}

/**
 * Read a file's content (text only, size-capped). The editor language is
 * derived from the extension.
 */
export function handleIdeFileGetRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  getRoots: () => string[],
): void {
  if (req.method === 'OPTIONS') return handleOptions(res, req, expectedOrigin)
  if (req.method !== 'GET') return finishJson(res, 405, { error: 'method not allowed' })
  if (!enforceOrigin(res, req, expectedOrigin)) return finishJson(res, 403, { error: 'forbidden' })

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
  const requested = url.searchParams.get('path')
  if (requested === null) return finishJson(res, 400, { error: 'path required' })

  const canonical = resolveAllowedPath(getRoots(), requested)
  if (canonical === null) return finishJson(res, 403, { error: 'path outside allowed roots' })
  let stat
  try {
    stat = statSync(canonical)
  } catch {
    return finishJson(res, 404, { error: 'not found' })
  }
  if (!stat.isFile()) return finishJson(res, 400, { error: 'not a file' })
  if (stat.size > MAX_READ_SIZE) {
    return finishJson(res, 413, { error: 'file too large', size: stat.size })
  }
  let buffer: Buffer
  try {
    buffer = readFileSync(canonical)
  } catch {
    return finishJson(res, 500, { error: 'read failed' })
  }
  if (buffer.subarray(0, 8_192).includes(0)) {
    return finishJson(res, 415, { error: 'binary file not supported' })
  }
  const response: DesktopIdeFileResponse = {
    path: canonical,
    content: buffer.toString('utf8'),
    language: languageFromPath(canonical),
    size: stat.size,
  }
  finishJson(res, 200, response)
}

/**
 * Write a file (create or overwrite). Parent directories are created on
 * demand; the resolved path must stay inside the allowed roots.
 */
export async function handleIdeFileWriteRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  getRoots: () => string[],
): Promise<void> {
  if (req.method === 'OPTIONS') return handleOptions(res, req, expectedOrigin)
  if (req.method !== 'POST') return finishJson(res, 405, { error: 'method not allowed' })
  if (!enforceOrigin(res, req, expectedOrigin)) return finishJson(res, 403, { error: 'forbidden' })

  let body: DesktopIdeFileWrite
  try {
    body = JSON.parse(await readBody(req)) as DesktopIdeFileWrite
  } catch {
    return finishJson(res, 400, { error: 'invalid body' })
  }
  if (typeof body.path !== 'string' || body.path.length === 0 || typeof body.content !== 'string') {
    return finishJson(res, 400, { error: 'path and content required' })
  }
  if (Buffer.byteLength(body.content, 'utf8') > MAX_WRITE_SIZE) {
    return finishJson(res, 413, { error: 'content too large' })
  }

  const canonical = resolveAllowedPath(getRoots(), body.path)
  if (canonical === null) return finishJson(res, 403, { error: 'path outside allowed roots' })
  try {
    mkdirSync(dirname(canonical), { recursive: true })
    writeFileSync(canonical, body.content, 'utf8')
  } catch (cause) {
    return finishJson(res, 500, { error: 'write failed', detail: cause instanceof Error ? cause.message : String(cause) })
  }
  finishJson(res, 200, { ok: true, path: canonical })
}

/**
 * Dispatcher for the single `DESKTOP_IDE_FILE_PATH` registration: GET reads,
 * POST writes, OPTIONS answers the CORS preflight.
 */
export function handleIdeFileRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  getRoots: () => string[],
): void {
  if (req.method === 'OPTIONS') return handleOptions(res, req, expectedOrigin)
  if (req.method === 'GET') return handleIdeFileGetRequest(req, res, expectedOrigin, getRoots)
  if (req.method === 'POST') return void handleIdeFileWriteRequest(req, res, expectedOrigin, getRoots)
  return finishJson(res, 405, { error: 'method not allowed' })
}

/**
 * Register the directory of the currently opened file as a Host workspace so
 * new conversations start there. The directory must stay inside the allowed
 * roots; the actual workspace creation is delegated to the Host
 * (`ctx.workspaceRegistry`), guarded so a missing service is a no-op.
 */
export async function handleIdeWorkspaceRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  getRoots: () => string[],
  ensureWorkspace: (dir: string) => Promise<void>,
): Promise<void> {
  if (req.method === 'OPTIONS') return handleOptions(res, req, expectedOrigin)
  if (req.method !== 'POST') return finishJson(res, 405, { error: 'method not allowed' })
  if (!enforceOrigin(res, req, expectedOrigin)) return finishJson(res, 403, { error: 'forbidden' })

  let body: { dir?: unknown }
  try {
    body = JSON.parse(await readBody(req)) as { dir?: unknown }
  } catch {
    return finishJson(res, 400, { error: 'invalid body' })
  }
  if (typeof body.dir !== 'string' || body.dir.length === 0) {
    return finishJson(res, 400, { error: 'dir required' })
  }
  const canonical = resolveAllowedPath(getRoots(), body.dir)
  if (canonical === null) return finishJson(res, 403, { error: 'path outside allowed roots' })
  try {
    await ensureWorkspace(canonical)
  } catch (cause) {
    return finishJson(res, 500, {
      error: 'workspace registration failed',
      detail: cause instanceof Error ? cause.message : String(cause),
    })
  }
  finishJson(res, 200, { ok: true, dir: canonical })
}
