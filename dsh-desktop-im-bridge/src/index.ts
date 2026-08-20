/**
 * IM gateway host integration.
 *
 * Registers the unified {@link ImGateway} as a host-side service, wires the
 * per-platform adapters (QQ / 飞书 / 微信), and exposes management routes the
 * desktop client calls over the same-origin loopback server:
 *   GET  /desktop/im-gateway/status   channel connection states
 *   GET  /desktop/im-gateway/config   current persisted config
 *   POST /desktop/im-gateway/config   replace config + hot-reload channels
 *   POST /desktop/im-gateway/qr       request a QR login for a channel (QQ)
 *   POST /desktop/im-gateway/reload   reconnect all channels from config
 *
 * The gateway runs in the same host process as the DeepSeek Harness engine, so
 * it can reach the local agent directly (no extra port discovery needed).
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { HarnessClient } from './harness-client.ts'
import { ImGateway } from './gateway.ts'
import { loadConfig, loadConfigSync, saveConfig } from './config-store.ts'
import { FeishuChannel } from './channels/feishu.ts'
import { WeixinChannel } from './channels/weixin.ts'
import { QqChannel } from './channels/qq.ts'

interface JsonBody {
  ok: boolean
  error?: string
  [key: string]: unknown
}

/** Register the IM gateway into the host process. @returns disposer. */
export function installImGateway(ctx: Context): () => void {
  const base = `http://${ctx.webServer.host}:${ctx.webServer.port}`
  const harness = new HarnessClient(base)
  // Read config from disk on every access so route edits are picked up live.
  const gateway = new ImGateway(loadConfigSync, harness)
  gateway.register('qq', () => new QqChannel())
  gateway.register('feishu', () => new FeishuChannel())
  gateway.register('weixin', () => new WeixinChannel())

  const routeDispose = installRoutes(ctx, gateway)
  // Connect enabled channels immediately. Fire-and-forget, but never let a
  // rejection here become an unhandled rejection that crashes the whole app.
  void gateway.start().catch((cause: unknown) => {
    ctx.logger.error('[im-gateway] 启动/重连失败（已忽略，不影响其他功能）:')
    ctx.logger.error(cause)
  })

  return () => {
    routeDispose()
    gateway.dispose()
  }
}

function installRoutes(ctx: Context, gateway: ImGateway): () => void {
  const disposers = [
    ctx.webServer.register({
      kind: 'exact',
      path: '/desktop/im-gateway/status',
      handler: jsonHandler(async () => gateway.status()),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/desktop/im-gateway/config',
      handler: makeConfigHandler(gateway),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/desktop/im-gateway/qr',
      handler: jsonHandler(async (req) => {
        const body = await readJson<{ channelId?: string }>(req)
        const adapter = body.channelId ? gateway.getAdapter(body.channelId) : undefined
        if (!adapter?.qrLogin) {
          throw new Error('该通道不支持扫码登录')
        }
        return adapter.qrLogin()
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/desktop/im-gateway/reload',
      handler: jsonHandler(async () => {
        await gateway.reload()
        return { ok: true }
      }),
    }),
  ]
  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        /* ignore */
      }
    }
  }
}

function makeConfigHandler(gateway: ImGateway): (req: IncomingMessage, res: ServerResponse) => void {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    applyCors(req, res)
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    try {
      if (req.method === 'GET') {
        sendJson(res, 200, await loadConfig())
        return
      }
      if (req.method === 'POST') {
        const body = await readJson<{ channels?: unknown }>(req)
        if (!body.channels || !Array.isArray(body.channels)) {
          throw new Error('config 必须包含 channels 数组')
        }
        await saveConfig({ channels: body.channels as never })
        await gateway.reload()
        sendJson(res, 200, { ok: true })
        return
      }
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
    } catch (cause) {
      sendJson(res, 400, { ok: false, error: cause instanceof Error ? cause.message : String(cause) })
    }
  }
}

function jsonHandler(
  fn: (req: IncomingMessage) => Promise<unknown>,
): (req: IncomingMessage, res: ServerResponse) => void {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const data = await fn(req)
      sendJson(res, 200, data)
    } catch (cause) {
      sendJson(res, 500, { ok: false, error: cause instanceof Error ? cause.message : String(cause) })
    }
  }
}

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin
  res.setHeader('access-control-allow-origin', origin ?? '*')
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type')
  res.setHeader('access-control-max-age', '600')
}

function readJson<T>(req: IncomingMessage, limit = 1_000_000): Promise<T> {
  return new Promise((resolve, reject) => {
    let size = 0
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      size += chunk.length
      if (size > limit) {
        req.destroy()
        reject(new Error('request body exceeded size limit'))
        return
      }
      data += chunk
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(data) as T)
      } catch (cause) {
        reject(cause)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: JsonBody | unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

// --- Cordis plugin entry: promotes this package to a toggleable Desktop bundle ---
// The host Loader imports the package root and treats the named `apply` export as
// a Cordis plugin. Registering it through `dsh.profile.bundles` (see
// dsh-plugin-desktop/src/profile.ts) makes it appear in the built-in plugin list
// and the marketplace's installed view, where the user can disable/enable it.
export const name = 'desktop-im-gateway'
export const inject = ['webServer']
export function apply(ctx: Context): void {
  ctx.effect(() => {
    try {
      return installImGateway(ctx)
    } catch (e) {
      ctx.logger.error('dsh-desktop-im-bridge: 初始化失败，已跳过（不影响其他功能）：')
      ctx.logger.error(e)
      return () => {}
    }
  }, 'dsh-desktop-im-bridge: host integration')
}
