/**
 * Workflow execution engine.
 *
 * A workflow is a DAG of nodes. The runner topologically orders it, then walks
 * the order and executes one node at a time: `start` seeds the graph with the
 * user's input, every `agent` calls its own model with its own prompt (so each
 * node can be a different provider/model — that is the "multi-agent" part), and
 * `end` collects whatever reached it. Each node sees its upstream answers via
 * the `{{input}}` template variable, and any earlier node's answer via
 * `{{节点名}}`.
 *
 * All HTTP goes through the Host proxy (`proxyFetch`) because the renderer is
 * sandboxed and same-origin only.
 */

import type { Workflow, WorkflowEdge, WorkflowNode } from './workflow-types.ts'
import { getApiKey } from '../api/api-service.ts'
import { proxyFetch } from '../../http-proxy.ts'
import { DEFAULT_PROVIDER_ID, resolveChatUrl, resolveEndpoint } from './model-catalog.ts'

/** Result of ordering a graph for execution. */
export interface TopoResult {
  /** Node ids in a valid execution order (empty tail when a cycle exists). */
  order: readonly string[]
  /** Whether the graph contains a cycle, making a full order impossible. */
  cyclic: boolean
}

/**
 * Order nodes so every node runs after all of its upstream neighbours (Kahn).
 * @param nodes - graph nodes, defining the tie-break order.
 * @param edges - directed connections.
 */
export function topoOrder(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[]): TopoResult {
  const indegree = new Map<string, number>()
  for (const node of nodes) indegree.set(node.id, 0)
  for (const edge of edges) {
    if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
  }
  const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id)
  const order: string[] = []
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) break
    order.push(current)
    for (const edge of edges) {
      if (edge.from !== current) continue
      const next = (indegree.get(edge.to) ?? 0) - 1
      indegree.set(edge.to, next)
      if (next === 0) queue.push(edge.to)
    }
  }
  return { order, cyclic: order.length !== nodes.length }
}

/**
 * Substitute `{{name}}` placeholders. Unknown keys are left untouched so typos
 * stay visible in the prompt instead of silently vanishing.
 * @param template - raw prompt text.
 * @param vars - available variables, keyed by placeholder name.
 */
export function interpolate(template: string, vars: ReadonlyMap<string, string>): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, rawKey: string) => {
    const value = vars.get(rawKey.trim())
    return value === undefined ? match : value
  })
}

interface OpenAiResponse {
  choices?: Array<{ message?: { content?: unknown } }>
  error?: { message?: string }
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>
  error?: { message?: string }
}

/** Flatten an OpenAI-style content field (string or content-part array) into text. */
function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part !== null && typeof part === 'object') {
          const text = (part as { text?: unknown }).text
          if (typeof text === 'string') return text
        }
        return ''
      })
      .join('')
  }
  return ''
}

/** Trim a provider error body down to something readable in the UI. */
function shorten(body: string): string {
  const compact = body.replace(/\s+/g, ' ').trim()
  return compact.length > 260 ? `${compact.slice(0, 260)}…` : compact
}

/**
 * Call one agent node's model.
 * @param node - the agent node carrying provider/model/prompt configuration.
 * @param userText - fully interpolated user message.
 * @param signal - abort signal from the run's stop button.
 * @returns the assistant's reply text.
 * @throws when no key is configured or the provider rejects the request.
 */
export async function callAgent(node: WorkflowNode, userText: string, signal?: AbortSignal): Promise<string> {
  const endpoint = resolveEndpoint(node.config.providerId.trim().length > 0 ? node.config.providerId : DEFAULT_PROVIDER_ID)
  const url = resolveChatUrl(endpoint, node.config.baseUrl)
  if (url.length === 0) {
    throw new Error(`节点「${node.name}」使用的「${endpoint.label}」需要自定义 API 地址：请在节点设置里填写 API 地址（如 https://your-host/v1）。`)
  }
  const key = node.config.apiKey.trim().length > 0 ? node.config.apiKey.trim() : getApiKey(endpoint.keyProviderId ?? endpoint.id)
  if (key.length === 0) {
    throw new Error(`节点「${node.name}」缺少 ${endpoint.label} 的 API Key，请在左栏「API 设置」中填写，或在节点里单独填写。`)
  }
  const model = node.config.model.trim().length > 0 ? node.config.model.trim() : (endpoint.models[0]?.id ?? '')
  if (model.length === 0) throw new Error(`节点「${node.name}」未选择模型。`)

  const temperature = Number.isFinite(node.config.temperature) ? node.config.temperature : 0.7
  const maxTokens = node.config.maxTokens > 0 ? Math.round(node.config.maxTokens) : 0
  const system = node.config.system.trim()

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let body: Record<string, unknown>
  if (endpoint.style === 'anthropic') {
    headers['x-api-key'] = key
    headers['anthropic-version'] = '2023-06-01'
    body = {
      model,
      max_tokens: maxTokens > 0 ? maxTokens : 4096,
      temperature,
      messages: [{ role: 'user', content: userText }],
    }
    if (system.length > 0) body.system = system
  } else {
    headers.Authorization = `Bearer ${key}`
    const messages: Array<{ role: string; content: string }> = []
    if (system.length > 0) messages.push({ role: 'system', content: system })
    messages.push({ role: 'user', content: userText })
    body = { model, messages, temperature, stream: false }
    if (maxTokens > 0) body.max_tokens = maxTokens
  }

  const init: RequestInit = { method: 'POST', headers, body: JSON.stringify(body) }
  if (signal !== undefined) init.signal = signal
  const response = await proxyFetch(url, init)
  const raw = await response.text()
  if (!response.ok) {
    let detail = shorten(raw)
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string } }
      if (typeof parsed.error?.message === 'string') detail = shorten(parsed.error.message)
    } catch {
      /* keep the raw body */
    }
    throw new Error(`${endpoint.label} 返回 HTTP ${String(response.status)}${detail.length > 0 ? `：${detail}` : ''}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${endpoint.label} 返回了无法解析的响应：${shorten(raw)}`)
  }
  if (endpoint.style === 'anthropic') {
    const data = parsed as AnthropicResponse
    const text = (data.content ?? [])
      .filter((block) => block.type === undefined || block.type === 'text')
      .map((block) => block.text ?? '')
      .join('')
    if (text.trim().length === 0) throw new Error(`${endpoint.label} 未返回内容${data.error?.message !== undefined ? `：${data.error.message}` : ''}`)
    return text
  }
  const data = parsed as OpenAiResponse
  const text = flattenContent(data.choices?.[0]?.message?.content)
  if (text.trim().length === 0) throw new Error(`${endpoint.label} 未返回内容${data.error?.message !== undefined ? `：${data.error.message}` : ''}`)
  return text
}

/** Callbacks the canvas uses to stream run progress into the run store. */
export interface RunHooks {
  onNodeStart: (nodeId: string) => void
  onNodeDone: (nodeId: string, output: string, ms: number) => void
  onNodeError: (nodeId: string, message: string, ms: number) => void
  onLog: (line: string) => void
}

/** Summary of a finished run. */
export interface RunSummary {
  /** Output text per node id. */
  outputs: ReadonlyMap<string, string>
  /** Number of nodes that failed. */
  failed: number
  /** Concatenated text produced by terminal (`end`) nodes. */
  result: string
}

/**
 * Execute a workflow node by node.
 * @param workflow - the graph to run.
 * @param input - the user's run input, fed into `start` nodes and `{{origin}}`.
 * @param hooks - progress callbacks.
 * @param signal - abort signal; the run stops before the next node starts.
 * @throws when the graph is empty or cyclic.
 */
export async function runWorkflow(
  workflow: Workflow,
  input: string,
  hooks: RunHooks,
  signal?: AbortSignal,
): Promise<RunSummary> {
  if (workflow.nodes.length === 0) throw new Error('画布上还没有节点，请先添加节点。')
  const { order, cyclic } = topoOrder(workflow.nodes, workflow.edges)
  if (cyclic) throw new Error('工作流存在环形连接，无法确定执行顺序，请检查节点之间的连线。')

  const byId = new Map(workflow.nodes.map((node) => [node.id, node]))
  const outputs = new Map<string, string>()
  const failedNodes = new Set<string>()
  let failed = 0

  for (const nodeId of order) {
    if (signal?.aborted === true) throw new Error('运行已停止。')
    const node = byId.get(nodeId)
    if (node === undefined) continue

    const upstream = workflow.edges.filter((edge) => edge.to === nodeId).map((edge) => edge.from)
    const blocked = upstream.filter((id) => failedNodes.has(id))
    if (blocked.length > 0) {
      failedNodes.add(nodeId)
      failed += 1
      hooks.onNodeError(nodeId, '上游节点失败，已跳过。', 0)
      continue
    }
    const upstreamText = upstream
      .map((id) => outputs.get(id) ?? '')
      .filter((text) => text.trim().length > 0)
      .join('\n\n')

    const vars = new Map<string, string>([['input', upstreamText], ['origin', input]])
    for (const [id, text] of outputs) {
      const source = byId.get(id)
      if (source !== undefined) vars.set(source.name, text)
    }

    if (node.kind === 'start') {
      const seeded = input.trim().length > 0 ? input : interpolate(node.config.prompt, vars)
      outputs.set(nodeId, seeded)
      hooks.onNodeDone(nodeId, seeded, 0)
      continue
    }
    if (node.kind === 'end') {
      outputs.set(nodeId, upstreamText)
      hooks.onNodeDone(nodeId, upstreamText, 0)
      continue
    }

    const template = node.config.prompt.trim().length > 0 ? node.config.prompt : '{{input}}'
    let userText = interpolate(template, vars).trim()
    if (userText.length === 0) userText = upstreamText.trim().length > 0 ? upstreamText : input
    if (userText.trim().length === 0) {
      failedNodes.add(nodeId)
      failed += 1
      hooks.onNodeError(nodeId, '没有可用的输入内容（上游为空且提示词为空）。', 0)
      continue
    }

    hooks.onNodeStart(nodeId)
    hooks.onLog(`▶ ${node.name} · ${node.config.model.length > 0 ? node.config.model : '默认模型'}`)
    const startedAt = Date.now()
    try {
      const text = await callAgent(node, userText, signal)
      const ms = Date.now() - startedAt
      outputs.set(nodeId, text)
      hooks.onNodeDone(nodeId, text, ms)
      hooks.onLog(`✓ ${node.name} 完成（${String(ms)}ms，${String(text.length)} 字）`)
    } catch (cause) {
      const ms = Date.now() - startedAt
      const message = cause instanceof Error ? cause.message : String(cause)
      failedNodes.add(nodeId)
      failed += 1
      hooks.onNodeError(nodeId, message, ms)
      hooks.onLog(`✗ ${node.name} 失败：${message}`)
      if (signal?.aborted) throw new Error('运行已停止。')
    }
  }

  const terminals = workflow.nodes.filter((node) => node.kind === 'end')
  const tail = terminals.length > 0 ? terminals : workflow.nodes.filter((node) => !workflow.edges.some((edge) => edge.from === node.id))
  const result = tail
    .map((node) => outputs.get(node.id) ?? '')
    .filter((text) => text.trim().length > 0)
    .join('\n\n---\n\n')

  return { outputs, failed, result }
}
