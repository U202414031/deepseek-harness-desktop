/**
 * Desktop-owned marketplace install bridge.
 *
 * The Web renderer cannot reach the Host-only `desktopPnpm` / `desktopProfiles`
 * services, so the marketplace UI in the client posts install requests to these
 * loopback routes. Each handler validates the requested spec against a strict
 * trust policy and then drives `desktopPnpm.runPlugin`, the same authority the
 * upstream `dsh plugin` CLI uses, so profile reconciliation stays correct.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from './profile-service.ts'
import type {} from './pnpm.ts'

/** One of the package-manager subcommands the marketplace exposes. */
type MarketplaceMode = 'install' | 'uninstall' | 'update'

/** pnpm subcommand forwarded after `dsh plugin --profile <active>`. */
const MODE_COMMAND: Record<MarketplaceMode, 'add' | 'remove' | 'update'> = {
  install: 'add',
  uninstall: 'remove',
  update: 'update',
}

/** Register the marketplace install/uninstall/update routes. @returns disposer removing all three. */
export function installMarketplaceRoutes(ctx: Context): () => void {
  const disposers = [
    ctx.webServer.register({ kind: 'exact', path: '/desktop/marketplace/install', handler: makeHandler('install') }),
    ctx.webServer.register({ kind: 'exact', path: '/desktop/marketplace/uninstall', handler: makeHandler('uninstall') }),
    ctx.webServer.register({ kind: 'exact', path: '/desktop/marketplace/update', handler: makeHandler('update') }),
  ]
  return () => { for (const dispose of disposers) dispose() }

  function makeHandler(mode: MarketplaceMode) {
    return (req: IncomingMessage, res: ServerResponse): void => {
      void handle(req, res, mode)
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse, mode: MarketplaceMode): Promise<void> {
    applyCors(req, res)
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    const controller = new AbortController()
    req.on('close', () => { controller.abort() })
    try {
      const raw = await readBody(req)
      const parsed = JSON.parse(raw) as { spec?: unknown }
      const spec = validateSpec(parsed.spec)
      const operation = ctx.desktopPnpm.runPlugin(
        [MODE_COMMAND[mode], spec],
        ctx.desktopProfiles.current.dir,
        controller.signal,
      )
      const chunks: string[] = []
      operation.stdout.setEncoding('utf8')
      operation.stderr.setEncoding('utf8')
      operation.stdout.on('data', chunk => chunks.push(String(chunk)))
      operation.stderr.on('data', chunk => chunks.push(String(chunk)))
      const outcome = await operation.done
      sendJson(res, 200, {
        ok: outcome.exitCode === 0 && outcome.signal === null,
        exitCode: outcome.exitCode,
        signal: outcome.signal,
        log: chunks.join(''),
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      sendJson(res, 400, { ok: false, error: message })
    }
  }
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
  return new Promise((resolve, reject) => {
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
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

/**
 * Strict allow-list for install targets. Only bare npm names, scoped npm names
 * (optionally pinned), `github:` shorthand URLs, and `file:` paths are accepted.
 * Arbitrary URLs or shell-flavored specs are rejected to limit supply-chain risk.
 */
function validateSpec(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200) {
    throw new Error('plugin spec must be a short non-empty string')
  }
  if (/^(@[a-z0-9-~_]+:)?[a-z0-9-~_.]+(@[a-z0-9-~_.]+)?$/.test(raw)) return raw
  if (/^github:[\w.-]+\/[\w.-]+(#[\w.-]+)?$/.test(raw)) return raw
  if (/^file:[^\\0]+$/.test(raw)) return raw
  throw new Error(`unsupported plugin spec: ${raw}`)
}

interface RouteResponse {
  ok: boolean
  error?: string
  log?: string
  exitCode?: number | null
  signal?: NodeJS.Signals | null
}

function sendJson(res: ServerResponse, status: number, body: RouteResponse): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}
