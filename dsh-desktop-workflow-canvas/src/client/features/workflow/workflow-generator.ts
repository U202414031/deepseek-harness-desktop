/**
 * Conversational workflow generator: turn a one-line natural-language description
 * into a structured `WorkflowSpec` (nodes + edges + prompts + models + params).
 *
 * It reuses the same model-calling plumbing as the runner (`proxyFetch` through
 * the host proxy, `getApiKey`, `resolveEndpoint`/`resolveChatUrl`) so the
 * generator costs the user nothing extra — it uses whatever API key they already
 * saved in 「API 设置」.
 *
 * The model is asked for a strict JSON object (no markdown, no prose) and we
 * defensively extract + validate it, so even a chatty or fenced reply still works.
 */

import type { WorkflowSpec, WorkflowSpecEdge, WorkflowSpecNode } from './workflow-types.ts'
import { getApiKey } from './api-key.ts'
import { proxyFetch } from '../../http-proxy.ts'
import { DEFAULT_PROVIDER_ID, PROVIDER_ENDPOINTS, defaultModelFor, findEndpoint, resolveChatUrl, resolveEndpoint } from './model-catalog.ts'

/** Which provider/model the generator should call. */
export interface GenerateOptions {
  providerId: string
  model: string
}

const SYSTEM_PROMPT = `你是一个多 Agent 工作流架构师，负责把用户的自然语言需求转成可执行的「工作流」配置。

工作流由节点(Node)和连线(Edge)组成：
- 节点种类只有三种：start(输入)、agent(调用大模型处理)、end(汇总输出)。
- 每个 agent 节点会调用一个「服务商(providerId)的某个模型(model)」，并带有 system(身份/角色设定) 与 prompt(具体要做什么)。
- prompt 里可用占位符：{{input}} 表示上游传给它的内容；{{节点名}} 表示引用某个上游节点的输出。
- 连线把上游节点的输出传给下游节点，构成有向无环图(DAG)。绝大多数需求是一条线性链路：start → agent1 → agent2 → … → end。

输出要求（极其重要）：
1. 只输出一个 JSON 对象，不要使用 markdown 代码块，不要输出任何解释性文字。
2. JSON 结构如下：
{
  "name": "简短的中文工作流名称",
  "nodes": [
    { "kind": "start", "name": "输入" },
    { "kind": "agent", "name": "翻译", "providerId": "deepseek", "model": "deepseek-v4-flash", "system": "你是一个专业翻译", "prompt": "把{{input}}翻译成英文", "temperature": 0.3, "maxTokens": 0 },
    { "kind": "end", "name": "输出" }
  ],
  "edges": [
    { "from": "输入", "to": "翻译" },
    { "from": "翻译", "to": "输出" }
  ]
}
3. nodes 数组必须【以 start 开头、以 end 结尾】，中间是 1 个或多个 agent。
4. agent 节点的 providerId 与 model 必须从下方「可用服务商与模型」清单里选择真实存在的组合，严禁编造。
5. 为每个 agent 写出【具体、可执行、中文】的 system 与 prompt；prompt 要清楚说明输入来自哪里(用 {{input}} 或 {{上游节点名}})、要产出什么。
6. temperature：事实/翻译/格式/代码类用 0.1～0.4，创意/文案/发散类用 0.6～0.9；maxTokens 一般用 0(代表默认) 或 1024/2048。
7. edges 必须覆盖所有相邻节点(包括 start→第一个agent、最后一个agent→end)，形成从输入到输出的完整链路；不要出现环。`

function buildUserPrompt(description: string): string {
  const catalog = PROVIDER_ENDPOINTS
    .map((provider) => `- ${provider.id}: ${provider.models.map((model) => model.id).join(', ')}`)
    .join('\n')
  return `可用服务商与模型（providerId: 模型id）：\n${catalog}\n\n用户需求：\n${description}\n\n请只输出符合上方结构的 JSON 对象。`
}

/** Flatten an OpenAI/Anthropic-style content field into text. */
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

/** Pull a JSON object out of a model reply that may be fenced or wrapped in prose. */
function extractJson(text: string): unknown {
  let working = text.trim()
  const fence = working.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const fenced = fence?.[1]
  if (fenced !== undefined) working = fenced.trim()
  const start = working.indexOf('{')
  const end = working.lastIndexOf('}')
  if (start >= 0 && end > start) working = working.slice(start, end + 1)
  return JSON.parse(working)
}

/** Call the generator model and return its raw text reply. */
async function callModel(endpointId: string, model: string, userText: string, signal?: AbortSignal): Promise<string> {
  const endpoint = resolveEndpoint(endpointId)
  const url = resolveChatUrl(endpoint, '')
  if (url.length === 0) {
    throw new Error(`服务商「${endpoint.label}」需要自定义 API 地址，无法用于生成工作流。请在节点设置里配置，或换一个不需要自定义地址的服务商。`)
  }
  const key = getApiKey(endpoint.keyProviderId ?? endpoint.id)
  if (key.length === 0) {
    throw new Error(`缺少 ${endpoint.label} 的 API Key。请先到左栏「API 设置」填写密钥，生成器才能调用模型。`)
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let body: Record<string, unknown>
  if (endpoint.style === 'anthropic') {
    headers['x-api-key'] = key
    headers['anthropic-version'] = '2023-06-01'
    body = {
      model,
      max_tokens: 4096,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userText }],
    }
  } else {
    headers.Authorization = `Bearer ${key}`
    body = {
      model,
      temperature: 0.2,
      stream: false,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
    }
  }

  const init: RequestInit = { method: 'POST', headers, body: JSON.stringify(body) }
  if (signal !== undefined) init.signal = signal
  const response = await proxyFetch(url, init)
  const raw = await response.text()
  if (!response.ok) {
    let detail = raw.replace(/\s+/g, ' ').trim()
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string } }
      if (typeof parsed.error?.message === 'string') detail = parsed.error.message
    } catch {
      /* keep raw */
    }
    throw new Error(`${endpoint.label} 返回 HTTP ${String(response.status)}${detail.length > 0 ? `：${detail}` : ''}`)
  }
  const parsed = JSON.parse(raw) as { choices?: Array<{ message?: { content?: unknown } }>; content?: Array<{ type?: string; text?: string }> }
  const text = endpoint.style === 'anthropic'
    ? (parsed.content ?? []).filter((block) => block.type === undefined || block.type === 'text').map((block) => block.text ?? '').join('')
    : flattenContent(parsed.choices?.[0]?.message?.content)
  if (text.trim().length === 0) throw new Error(`${endpoint.label} 未返回内容，无法生成工作流。`)
  return text
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Coerce a loosely-typed model reply into a safe, render-ready spec. */
function normalizeSpec(raw: unknown): WorkflowSpec {
  if (raw === null || typeof raw !== 'object') throw new Error('模型返回的不是有效的 JSON 对象。')
  const source = raw as Record<string, unknown>
  const rawNodes = Array.isArray(source.nodes) ? source.nodes : []
  const rawEdges = Array.isArray(source.edges) ? source.edges : []

  const nodes: WorkflowSpecNode[] = rawNodes.map((entry, index) => {
    const record = (entry ?? {}) as Record<string, unknown>
    const kindRaw = String(record.kind ?? 'agent')
    const kind = kindRaw === 'start' || kindRaw === 'end' ? kindRaw : 'agent'
    const name = typeof record.name === 'string' && record.name.trim().length > 0
      ? record.name.trim()
      : (kind === 'start' ? '输入' : kind === 'end' ? '输出' : `Agent ${String(index + 1)}`)
    const providerId = typeof record.providerId === 'string' && findEndpoint(record.providerId) !== undefined
      ? record.providerId
      : DEFAULT_PROVIDER_ID
    const model = typeof record.model === 'string' && (findEndpoint(providerId)?.models.some((m) => m.id === record.model) ?? false)
      ? record.model
      : defaultModelFor(providerId)
    const temperature = typeof record.temperature === 'number' && Number.isFinite(record.temperature)
      ? clamp(record.temperature, 0, 2)
      : 0.7
    const maxTokens = typeof record.maxTokens === 'number' && record.maxTokens >= 0 ? Math.round(record.maxTokens) : 0
    const node: WorkflowSpecNode = { kind, name }
    if (kind === 'agent') {
      node.providerId = providerId
      node.model = model
      node.system = typeof record.system === 'string' ? record.system : ''
      node.prompt = typeof record.prompt === 'string' ? record.prompt : ''
      node.temperature = temperature
      node.maxTokens = maxTokens
    }
    return node
  })

  // Guarantee a leading start and a trailing end so the graph is always runnable.
  if (nodes.length === 0 || nodes[0]!.kind !== 'start') {
    nodes.unshift({ kind: 'start', name: '输入' })
  }
  if (nodes[nodes.length - 1]!.kind !== 'end') {
    nodes.push({ kind: 'end', name: '输出' })
  }

  const names = new Set(nodes.map((node) => node.name))
  const edgeSet = new Set<string>()
  const edges: WorkflowSpecEdge[] = []
  const addEdge = (from: string, to: string): void => {
    if (!names.has(from) || !names.has(to) || from === to) return
    const key = `${from}→${to}`
    if (edgeSet.has(key)) return
    edgeSet.add(key)
    edges.push({ from, to })
  }

  if (rawEdges.length > 0) {
    for (const entry of rawEdges) {
      const record = (entry ?? {}) as Record<string, unknown>
      if (typeof record.from === 'string' && typeof record.to === 'string') addEdge(record.from, record.to)
    }
  }
  // Fallback: chain nodes in order when no valid edges were produced.
  if (edges.length === 0) {
    for (let index = 0; index < nodes.length - 1; index += 1) addEdge(nodes[index]!.name, nodes[index + 1]!.name)
  }

  const name = typeof source.name === 'string' && source.name.trim().length > 0 ? source.name.trim() : 'AI 生成的工作流'
  return { name, nodes, edges }
}

/**
 * Generate a workflow spec from a natural-language description.
 * @throws when no API key is configured, the provider rejects the call, or the
 *         reply cannot be parsed into a usable spec.
 */
export async function generateWorkflowSpec(description: string, options: GenerateOptions, signal?: AbortSignal): Promise<WorkflowSpec> {
  const model = options.model.trim().length > 0 ? options.model.trim() : defaultModelFor(options.providerId)
  const text = await callModel(options.providerId, model, buildUserPrompt(description), signal)
  let parsed: unknown
  try {
    parsed = extractJson(text)
  } catch {
    throw new Error('模型返回的内容无法解析为 JSON，请重试或换一个表述更清楚的模型。')
  }
  return normalizeSpec(parsed)
}
