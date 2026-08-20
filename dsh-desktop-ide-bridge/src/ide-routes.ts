/**
 * HTTP handlers backing the embedded IDE panel: one read-only endpoint that
 * returns the live IDE URL and status, one endpoint for reading/updating the
 * allowed-directory allow-list (persisted and applied by restarting the IDE),
 * one endpoint that starts the embedded openvscode-server lazily, one endpoint
 * that forwards an editor selection into the live AI agent, and one endpoint
 * that opens the workspace in the user's native VS Code.
 *
 * Origin policy: every route enforces the same-origin rule used by the other
 * desktop loopback routes. The embedded IDE runs on its own loopback port, so
 * its browser requests carry a different `Origin`; loopback origins
 * (`http://127.0.0.1:<port>` / `http://localhost:<port>`) are additionally
 * allowed and answered with CORS headers, while arbitrary web origins are
 * rejected. Same-origin GETs may omit the header, and non-browser callers
 * (e.g. the native VS Code extension) send no Origin at all.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import type {
  DesktopIdeAskRequest,
  DesktopIdeConfigResponse,
  DesktopIdeConfigUpdate,
  DesktopIdeInfoResponse,
} from './ide-info-contract.ts'
import { loadIdeConfig, saveIdeConfig } from './ide-config.ts'
import type { IdeServerHandle } from './ide-server.ts'

function finishJson(res: ServerResponse, statusCode: number, value: object): void {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(value))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1_000_000) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Whether a request origin is trusted. Missing origins (native callers,
 * same-origin GETs) are trusted; exact match with the renderer origin is
 * trusted; any other loopback origin (`127.0.0.1` / `localhost`) is trusted so
 * the embedded IDE (a separate loopback server) can reach the ask/config
 * routes. Everything else is rejected.
 */
export function originAllowed(origin: string | undefined, expectedOrigin: string): boolean {
  if (origin === undefined || origin === expectedOrigin) return true
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)
}

/**
 * Enforce the origin policy for a request. When the origin is trusted and
 * present, the matching CORS header is attached so browser callers (the
 * embedded IDE) can read the response. Returns false when the caller must be
 * answered with 403.
 */
export function enforceOrigin(res: ServerResponse, req: IncomingMessage, expectedOrigin: string): boolean {
  const origin = req.headers.origin
  if (!originAllowed(origin, expectedOrigin)) return false
  if (origin !== undefined) res.setHeader('access-control-allow-origin', origin)
  return true
}

/** Answer a CORS preflight for any of the IDE routes. */
export function handleOptions(res: ServerResponse, req: IncomingMessage, expectedOrigin: string): void {
  const origin = req.headers.origin
  if (!originAllowed(origin, expectedOrigin)) {
    finishJson(res, 403, { error: 'forbidden' })
    return
  }
  res.statusCode = 204
  if (origin !== undefined) {
    res.setHeader('access-control-allow-origin', origin)
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    res.setHeader('access-control-allow-headers', 'content-type, accept')
    res.setHeader('access-control-max-age', '600')
  }
  res.end()
}

/**
 * Serve the current IDE loopback URL and status to the renderer.
 * @param getInfo - supplies the live IDE info snapshot.
 */
export function handleIdeInfoRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  getInfo: () => DesktopIdeInfoResponse,
): void {
  if (req.method === 'OPTIONS') return handleOptions(res, req, expectedOrigin)
  if (req.method !== 'GET') return finishJson(res, 405, { error: 'method not allowed' })
  if (!enforceOrigin(res, req, expectedOrigin)) return finishJson(res, 403, { error: 'forbidden' })
  finishJson(res, 200, getInfo())
}

/**
 * Read or update the IDE allowed-directory allow-list.
 * @param profileDir - active profile directory (config home).
 * @param getServer - resolves the live IDE server handle for restarts.
 */
export async function handleIdeConfigRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  profileDir: string,
  getServer: () => IdeServerHandle | undefined,
): Promise<void> {
  if (req.method === 'OPTIONS') return handleOptions(res, req, expectedOrigin)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return finishJson(res, 405, { error: 'method not allowed' })
  }
  if (!enforceOrigin(res, req, expectedOrigin)) return finishJson(res, 403, { error: 'forbidden' })

  if (req.method === 'GET') {
    const response: DesktopIdeConfigResponse = { allowedDirs: loadIdeConfig(profileDir).allowedDirs }
    finishJson(res, 200, response)
    return
  }

  let body: DesktopIdeConfigUpdate
  try {
    body = JSON.parse(await readBody(req)) as DesktopIdeConfigUpdate
  } catch {
    return finishJson(res, 400, { error: 'invalid body' })
  }

  const config = loadIdeConfig(profileDir)
  const set = new Set(config.allowedDirs)
  if (typeof body.add === 'string' && body.add.length > 0) set.add(body.add)
  if (typeof body.remove === 'string' && body.remove.length > 0) set.delete(body.remove)
  const next = { allowedDirs: [...set] }
  saveIdeConfig(profileDir, next)
  getServer()?.updateAllowedDirs(next.allowedDirs)
  finishJson(res, 200, next satisfies DesktopIdeConfigResponse)
}

/**
 * Resolve the agent that should receive an editor-forwarded message. The bridge
 * runs outside any agent-driven async chain, so `currentInitiator()` is unsafe;
 * instead we take the most recently registered live agent (the desktop shell
 * keeps a single foreground conversation in the common case).
 */
function pickActiveAgent(ctx: Context): ReturnType<AgentRegistry['list']>[number] | undefined {
  const registry = (ctx as { agents?: unknown }).agents as AgentRegistry | undefined
  if (registry === undefined || typeof registry.list !== 'function') return undefined
  const agents = registry.list()
  if (agents.length === 0) return undefined
  return agents[agents.length - 1]
}

/** Build the user message the agent will receive for a given editor selection. */
function buildAskMessage(req: DesktopIdeAskRequest): ReturnType<typeof createUserMessage> {
  const lang = req.language && req.language.trim().length > 0 ? req.language.trim() : 'text'
  let text: string
  if (req.mode === 'explain') {
    text = [
      `请解释下面这段位于文件 ${req.file} 的 ${lang} 代码：`,
      '',
      '```' + lang,
      req.selection,
      '```',
      '',
      '请用中文说明它的作用、关键逻辑以及需要注意的地方。',
    ].join('\n')
  } else {
    const instruction = (req.instruction ?? '').trim()
      || '在不改变整体行为的前提下，改进这段代码的清晰度、健壮性与性能。'
    text = [
      `请修改下面这段位于文件 ${req.file} 的 ${lang} 代码：`,
      '',
      '```' + lang,
      req.selection,
      '```',
      '',
      `修改要求：${instruction}`,
      `请只改动这段代码本身，并使用 str-replace 工具把改动写回原文件 ${req.file}。`,
    ].join('\n')
  }
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/**
 * Forward an editor selection into the live AI agent. The host builds a user
 * message carrying the selected code as context and injects it into the agent's
 * inbox with `wakeup: true`, so the agent answers (or edits the file) without
 * any browser-side plumbing. The embedded IDE and the native VS Code extension
 * both POST here.
 */
export async function handleIdeAskRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  ctx: Context,
): Promise<void> {
  if (req.method === 'OPTIONS') return handleOptions(res, req, expectedOrigin)
  if (req.method !== 'POST') return finishJson(res, 405, { error: 'method not allowed' })
  if (!enforceOrigin(res, req, expectedOrigin)) return finishJson(res, 403, { error: 'forbidden' })
  let body: DesktopIdeAskRequest
  try {
    body = JSON.parse(await readBody(req)) as DesktopIdeAskRequest
  } catch {
    return finishJson(res, 400, { error: 'invalid body' })
  }
  if (typeof body.selection !== 'string' || body.selection.length === 0) {
    return finishJson(res, 400, { error: 'selection required' })
  }
  if (body.mode !== 'explain' && body.mode !== 'modify') {
    return finishJson(res, 400, { error: 'mode must be explain|modify' })
  }
  const agent = pickActiveAgent(ctx)
  if (agent === undefined) {
    return finishJson(res, 409, { error: 'no-active-agent', hint: '请先在左侧发起一轮 AI 对话以创建会话' })
  }
  try {
    const message = buildAskMessage(body)
    agent.send(message, 'next-turn', true)
    finishJson(res, 200, { ok: true })
  } catch (err) {
    finishJson(res, 500, { error: 'agent-send-failed', detail: err instanceof Error ? err.message : String(err) })
  }
}

/**
 * Start the embedded IDE lazily. The panel POSTs here when it opens; repeated
 * calls are safe (the server handle ignores them once booting/running).
 * @param start - performs the (idempotent) start.
 */
export function handleIdeStartRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  start: () => void,
): void {
  if (req.method === 'OPTIONS') return handleOptions(res, req, expectedOrigin)
  if (req.method !== 'POST') return finishJson(res, 405, { error: 'method not allowed' })
  if (!enforceOrigin(res, req, expectedOrigin)) return finishJson(res, 403, { error: 'forbidden' })
  start()
  finishJson(res, 200, { ok: true })
}

/**
 * Persist the bridge endpoint the selection extension should POST to. Written
 * so the extension finds it regardless of where it runs:
 *  - `<profileDir>/.dsh-ide-bridge.json` — code-server-style deployment
 *    (extension located two levels up from the profile dir);
 *  - `~/.dsh-desktop/ide-bridge.json` — user-level fixed path, matching the
 *    lookup the extension uses when installed inside the user's native VS Code.
 */
export function writeIdeBridgeConfig(
  profileDir: string,
  baseUrl: string,
  askPath: string,
  homeDir: string = homedir(),
): void {
  const payload = JSON.stringify({ baseUrl, askPath }, null, 2)
  // Profile-dir candidate: code-server-style deployment, extension located two
  // levels up from the profile dir.
  try {
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, '.dsh-ide-bridge.json'), payload, 'utf8')
  } catch {
    // A missing write target must never break the IDE linkage setup.
  }
  // User-level candidate: matches the lookup the extension uses when installed
  // inside the user's native VS Code (`~/.dsh-desktop/ide-bridge.json`).
  try {
    const dir = join(homeDir, '.dsh-desktop')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'ide-bridge.json'), payload, 'utf8')
  } catch {
    // A missing write target must never break the IDE linkage setup.
  }
}

/**
 * Persist the bridge endpoint for the embedded openvscode-server: the
 * extension lives at `<profileDir>/.dsh-ide/extensions/dsh-ide-bridge`, so the
 * "two levels up" lookup resolves to `<profileDir>/.dsh-ide/.dsh-ide-bridge.json`.
 * The host additionally sets `DSH_IDE_BRIDGE_PATH` for the server process, so
 * this file is a second, independent fallback.
 */
export function writeEmbeddedIdeBridgeConfig(profileDir: string, baseUrl: string, askPath: string): void {
  const file = join(profileDir, '.dsh-ide', '.dsh-ide-bridge.json')
  try {
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ baseUrl, askPath }, null, 2), 'utf8')
  } catch {
    // The env override already covers the embedded extension; never fatal.
  }
}

/**
 * Ask the host to open the current workspace in the user's installed VS Code.
 * @param open - performs the launch; returns whether the editor was started.
 */
export function handleIdeOpenRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  open: () => boolean,
): void {
  if (req.method === 'OPTIONS') return handleOptions(res, req, expectedOrigin)
  if (req.method !== 'POST') return finishJson(res, 405, { error: 'method not allowed' })
  if (!enforceOrigin(res, req, expectedOrigin)) return finishJson(res, 403, { error: 'forbidden' })
  const launched = open()
  finishJson(res, launched ? 200 : 409, launched ? { ok: true } : { ok: false, error: 'vscode-not-found' })
}
