/**
 * HTTP handlers backing the embedded IDE panel: one read-only endpoint that
 * returns the live code-server URL, one endpoint for reading/updating the
 * allowed-directory allow-list (persisted and applied by restarting code-server),
 * and one endpoint that forwards an editor selection into the live AI agent.
 *
 * All enforce the same-origin rule used by the other desktop loopback routes: a
 * mismatched `Origin` is rejected. Same-origin GETs may omit the header.
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
 * Serve the current IDE loopback URL and status to the renderer.
 * @param getInfo - supplies the live IDE info snapshot.
 */
export function handleIdeInfoRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  getInfo: () => DesktopIdeInfoResponse,
): void {
  if (req.method !== 'GET') return finishJson(res, 405, { error: 'method not allowed' })
  const origin = req.headers.origin
  if (origin !== undefined && origin !== expectedOrigin) return finishJson(res, 403, { error: 'forbidden' })
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
  if (req.method !== 'GET' && req.method !== 'POST') {
    return finishJson(res, 405, { error: 'method not allowed' })
  }
  const origin = req.headers.origin
  if (origin !== undefined && origin !== expectedOrigin) return finishJson(res, 403, { error: 'forbidden' })

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
 * any browser-side plumbing. Cross-origin POSTs are rejected.
 */
export async function handleIdeAskRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  ctx: Context,
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, { error: 'method not allowed' })
  const origin = req.headers.origin
  if (origin !== undefined && origin !== expectedOrigin) return finishJson(res, 403, { error: 'forbidden' })
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
 * Persist the bridge endpoint the selection extension should POST to. Written
 * to TWO locations so the extension finds it regardless of where it runs:
 * the profile dir (code-server-style deployment, extension located two levels
 * up) and a user-level fixed path (`~/.dsh-desktop/ide-bridge.json`, used by
 * the extension installed inside the user's native VS Code).
 */
export function writeIdeBridgeConfig(profileDir: string, baseUrl: string, askPath: string): void {
  const payload = JSON.stringify({ baseUrl, askPath }, null, 2)
  const targets = [profileDir, join(homedir(), '.dsh-desktop')]
  for (const dir of targets) {
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, '.dsh-ide-bridge.json'), payload, 'utf8')
    } catch {
      // A missing write target must never break the IDE linkage setup.
    }
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
  if (req.method !== 'POST') return finishJson(res, 405, { error: 'method not allowed' })
  const origin = req.headers.origin
  if (origin !== undefined && origin !== expectedOrigin) return finishJson(res, 403, { error: 'forbidden' })
  const launched = open()
  finishJson(res, launched ? 200 : 409, launched ? { ok: true } : { ok: false, error: 'vscode-not-found' })
}
