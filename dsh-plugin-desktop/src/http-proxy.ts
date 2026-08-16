/**
 * Desktop-owned HTTP proxy bridge.
 *
 * The Web renderer is a sandboxed browser context that cannot make cross-origin
 * requests to third-party APIs (CORS). The Host process, by contrast, runs
 * Node and its global `fetch` is not subject to CORS. This module exposes a
 * loopback route (`/desktop/proxy`) that performs the upstream request in the
 * Host and streams the response back, mirroring the marketplace install bridge
 * in `marketplace-host.ts`.
 *
 * The route is intentionally a *restricted* proxy: it only forwards http/https
 * targets that are not loopback or private, so the local app cannot be abused
 * as an open proxy / SSRF pivot into an internal network.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import type {} from '@deepseek-ai/dsh-host-webserver'

const PROXY_PATH = '/desktop/proxy'

/** Headers that must never be forwarded to the upstream (control or hop-by-hop). */
const STRIP_REQUEST_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'x-proxy-url',
  'x-proxy-method',
])

/** Headers the proxy response should own; upstream copies are dropped to avoid conflicts. */
const STRIP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
])

/** Register the proxy route. @returns disposer removing the route. */
export function installHttpProxy(ctx: Context): () => void {
  return ctx.webServer.register({ kind: 'exact', path: PROXY_PATH, handler })
}

function handler(req: IncomingMessage, res: ServerResponse): void {
  void run(req, res)
}

async function run(req: IncomingMessage, res: ServerResponse): Promise<void> {
  applyCors(req, res)
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  const controller = new AbortController()
  req.on('close', () => { controller.abort() })
  try {
    const targetRaw = req.headers['x-proxy-url']
    if (typeof targetRaw !== 'string' || targetRaw.length === 0) {
      sendJson(res, 400, { ok: false, error: 'missing x-proxy-url header' })
      return
    }
    let target: URL
    try {
      target = new URL(targetRaw)
    } catch {
      sendJson(res, 400, { ok: false, error: 'invalid x-proxy-url' })
      return
    }
    if (!isPublicHttpUrl(target)) {
      sendJson(res, 400, { ok: false, error: 'target must be a public http(s) URL' })
      return
    }
    const method = String(req.headers['x-proxy-method'] ?? req.method ?? 'POST').toUpperCase()
    const forwarded = forwardRequestHeaders(req.headers)
    const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req)

    const upstreamInit: RequestInit = {
      method,
      headers: forwarded,
      signal: controller.signal,
    }
    if (body !== undefined) upstreamInit.body = body
    const upstream = await fetch(target, upstreamInit)
    res.statusCode = upstream.status
    upstream.headers.forEach((value, key) => {
      if (STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) return
      res.setHeader(key, value)
    })
    const buffer = Buffer.from(await upstream.arrayBuffer())
    res.end(buffer)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    sendJson(res, 502, { ok: false, error: message })
  }
}

/** Only allow http/https targeting public (non-loopback, non-private) hosts. */
function isPublicHttpUrl(target: URL): boolean {
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false
  const host = target.hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return false
  const octets = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (octets !== null) {
    const a = Number(octets[1])
    const b = Number(octets[2])
    if (a === 10) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 169 && b === 254) return false
    if (a === 127) return false
  }
  return true
}

/** Copy request headers to forward upstream, dropping control/hop-by-hop entries. */
function forwardRequestHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (STRIP_REQUEST_HEADERS.has(key.toLowerCase())) continue
    if (typeof value === 'string') out[key] = value
    else if (Array.isArray(value)) out[key] = value.join(', ')
  }
  return out
}

/** Allow the sandboxed renderer to call this loopback route. */
function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin
  res.setHeader('access-control-allow-origin', origin ?? '*')
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type, x-proxy-url, x-proxy-method')
  res.setHeader('access-control-max-age', '600')
}

/** Read a request body with a hard size cap (1 MB). */
function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    let size = 0
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        req.destroy()
        reject(new Error('request body exceeded size limit'))
        return
      }
      data += chunk
    })
    req.on('end', () => resolve(data.length > 0 ? data : undefined))
    req.on('error', reject)
  })
}

interface ProxyResponse {
  ok: boolean
  error?: string
}

function sendJson(res: ServerResponse, status: number, body: ProxyResponse): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}
