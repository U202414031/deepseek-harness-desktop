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

/** QQ 正式业务主机在机器人未上架（沙箱环境）时返回的指示错误码。 */
const QQ_SANDBOX_CODES = new Set<number>([11001, 11263, 130001, 130003, 130005])
const QQ_PRODUCTION_HOST = 'api.sgroup.qq.com'
const QQ_SANDBOX_HOST = 'sandbox.api.sgroup.qq.com'

/**
 * 对 QQ 正式业务主机做「沙箱自动回退」：若响应体 code 命中沙箱指示码
 * （机器人未上架，正式环境返回 11001「不支持的调用」等），自动改调沙箱
 * 主机并返回其结果。
 *
 * 放在主进程而非客户端：客户端在第一个响应 body 尚未读完时立即发起第二次
 * 代理请求，Chromium 可能复用连接失败（报 "Failed to fetch"）；主进程内
 * 重试则渲染进程全程只需处理一个响应。
 */
async function fetchWithSandboxRetry(target: URL, init: RequestInit): Promise<Response> {
  if (target.hostname !== QQ_PRODUCTION_HOST) return fetch(target, init)
  const first = await fetch(target, init)
  let code: number | undefined
  try {
    const data = await first.clone().json() as { code?: unknown }
    if (typeof data.code === 'number') code = data.code
  } catch {
    /* 非 JSON 响应不触发回退 */
  }
  if (code !== undefined && QQ_SANDBOX_CODES.has(code)) {
    const sandbox = new URL(target.href)
    sandbox.hostname = QQ_SANDBOX_HOST
    console.log(`[dsh-proxy] QQ 正式环境返回 code ${code}（未上架/沙箱），自动改用 ${sandbox.href}`)
    try {
      return await fetch(sandbox, init)
    } catch (cause) {
      console.log(`[dsh-proxy] 沙箱重试失败: ${cause instanceof Error ? cause.message : String(cause)}`)
      return first
    }
  }
  return first
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
  // 注意：Node 的 IncomingMessage 'close' 在请求体读完（消息完成）时就会触发，
  // 并非连接断开才触发——用它中止会让所有带 body 的请求立即失败
  // （AbortError: This operation was aborted）。正确检测客户端断开：
  // 请求侧用 'aborted'，响应侧在 res 'close' 时判断 writableFinished。
  req.on('aborted', () => { controller.abort() })
  res.on('close', () => {
    if (!res.writableFinished) controller.abort()
  })
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
    // 诊断日志：客户端发起的每个代理请求都会打印到主进程终端。
    const startedAt = Date.now()
    const upstream = await fetchWithSandboxRetry(target, upstreamInit)
    const buffer = Buffer.from(await upstream.arrayBuffer())
    const head = buffer.subarray(0, 160).toString('utf8').replace(/\s+/g, ' ')
    console.log(
      `[dsh-proxy] ${req.method} -> ${method} ${target.href} => HTTP ${upstream.status}（${Date.now() - startedAt}ms）body=${buffer.length}B head=${JSON.stringify(head)}`,
    )
    res.statusCode = upstream.status
    upstream.headers.forEach((value, key) => {
      if (STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) return
      res.setHeader(key, value)
    })
    res.end(buffer)
    res.on('close', () => {
      console.log(`[dsh-proxy] 响应写回${res.writableFinished ? '完成' : '中断'}(writableFinished=${res.writableFinished})`)
    })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    console.log(`[dsh-proxy] 失败: ${message}`)
    try {
      sendJson(res, 502, { ok: false, error: message })
    } catch (inner) {
      const innerMessage = inner instanceof Error ? inner.message : String(inner)
      console.log(`[dsh-proxy] 回写 502 也失败: ${innerMessage}（headersSent=${res.headersSent}）`)
      if (!res.writableEnded) res.destroy()
    }
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
