/**
 * Host-side client for the local DeepSeek Harness web API.
 *
 * The desktop app boots a full dsh host with a loopback web server
 * (`ctx.webServer`, bound to 127.0.0.1 + ephemeral port). This client talks to
 * it the same way external bridges (dsh-im-gateway, dsh-cc-connect) do:
 *   - `POST /api/<method>`  with a `client-request` envelope
 *   - `ws://…/api/events.mux` for the aggregated session event stream (streaming)
 *
 * Because the gateway runs inside the same host process we already know the
 * host/port, so no port discovery is needed.
 */

import type {
  HarnessBridge,
  HarnessSessionInfo,
  HostStatus,
  PromptHandlers,
} from './types.ts'

/** Envelope returned by every `/api` unary call. */
interface ServerResponse<T> {
  type: 'server-response'
  rpcId: string
  result: { ok: boolean; value?: T; error?: { code: string; message: string } }
}

/** Downlink WebSocket frame from `/api/events.mux`. */
interface MuxFrame {
  type: 'server-request'
  rpcId: string
  method: string
  payload: {
    sessionId?: string
    event?: { type: string; seq?: number; time?: number; data?: unknown }
  }
}

/** Raw session summary returned by `session.list`. */
interface RawSessionSummary {
  sessionId: string
  title?: string
  running?: boolean
  cwd?: string
}

function normalizeSession(raw: RawSessionSummary): HarnessSessionInfo {
  return {
    sessionId: String(raw.sessionId),
    running: Boolean(raw.running),
    ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
    ...(typeof raw.cwd === 'string' ? { cwd: raw.cwd } : {}),
  }
}

/**
 * Extract display text from an `assistant/chunk` event's `data.chunk`.
 * The chunk shape varies by harness version, so we probe the common fields.
 */
function extractChunkText(data: unknown): string {
  if (data === null || typeof data !== 'object') return ''
  const d = data as Record<string, unknown>
  const chunk = d.chunk
  if (chunk === undefined || chunk === null) {
    return typeof d.text === 'string' ? d.text : ''
  }
  if (typeof chunk === 'string') return chunk
  if (typeof chunk === 'object') {
    const c = chunk as Record<string, unknown>
    if (typeof c.text === 'string') return c.text
    if (typeof c.content === 'string') return c.content
    if (Array.isArray(c.content)) {
      return c.content
        .map((p) => (typeof p === 'string' ? p : (p as { text?: string }).text ?? ''))
        .join('')
    }
  }
  return ''
}

export class HarnessClient implements HarnessBridge {
  private seq = 0

  constructor(private readonly base: string) {}

  private nextRpcId(): string {
    this.seq += 1
    return `im-gw-${Date.now().toString(36)}-${this.seq}`
  }

  private async rpc<T>(method: string, payload: unknown): Promise<T> {
    const rpcId = this.nextRpcId()
    const response = await fetch(`${this.base}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
    })
    const data = (await response.json()) as ServerResponse<T>
    if (!data.result.ok || data.result.value === undefined) {
      throw new Error(data.result.error?.message ?? `harness ${method} failed`)
    }
    return data.result.value
  }

  async listSessions(): Promise<HarnessSessionInfo[]> {
    const data = await this.rpc<{ items: RawSessionSummary[] }>('session.list', {})
    return (data.items ?? []).map(normalizeSession)
  }

  async getStatus(): Promise<HostStatus> {
    return this.rpc<HostStatus>('host.describe', {})
  }

  async createSession(opts?: { cwd?: string; agentPreset?: string }): Promise<string> {
    const data = await this.rpc<{ sessionId: string }>('session.create', {
      cwd: opts?.cwd,
      agentPreset: opts?.agentPreset,
    })
    return data.sessionId
  }

  async cancel(sessionId: string): Promise<void> {
    await this.rpc('session.cancel', { sessionId })
  }

  async prompt(
    sessionId: string,
    text: string,
    handlers: PromptHandlers,
  ): Promise<void> {
    const accepted = await this.rpc<{ accepted: boolean }>('session.prompt', {
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
    })
    if (!accepted.accepted) {
      handlers.onError('harness 拒绝了该消息')
      return
    }

    const wsUrl = this.base.replace(/^http/, 'ws') + '/api/events.mux'
    const ws = new WebSocket(wsUrl)
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      fn()
    }

    ws.addEventListener('message', (ev: { data: unknown }) => {
      try {
        const frame = JSON.parse(String(ev.data)) as MuxFrame
        if (frame.type !== 'server-request' || frame.method !== 'session/event') return
        const payload = frame.payload
        if (payload.sessionId !== sessionId) return
        const event = payload.event
        if (!event) return
        if (event.type === 'assistant/chunk') {
          const out = extractChunkText(event.data)
          if (out) handlers.onChunk(out)
        } else if (event.type === 'tool/call') {
          const data = event.data as { name?: string; arguments?: unknown } | undefined
          handlers.onTool?.(typeof data?.name === 'string' ? data.name : '', data?.arguments)
        } else if (event.type === 'approval/requested') {
          // Best-effort auto-approve so tool calls can proceed unattended.
          void this.autoApprove(frame.rpcId)
        } else if (event.type === 'turn/end') {
          const data = event.data as { reason?: string } | undefined
          finish(() => handlers.onEnd(typeof data?.reason === 'string' ? data.reason : 'completed'))
        }
      } catch {
        /* ignore malformed frame */
      }
    })
    ws.addEventListener('error', () => finish(() => handlers.onError('harness 流式连接异常')))
    ws.addEventListener('close', () => finish(() => handlers.onEnd('closed')))
  }

  private async autoApprove(rpcId: string): Promise<void> {
    try {
      await fetch(`${this.base}/api/respond`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-response', rpcId, result: { outcome: 'approve' } }),
      })
    } catch {
      /* ignore — tool call will simply not auto-approve */
    }
  }
}
