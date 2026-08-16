import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { ProviderSpec } from '../api/provider-config.ts'

/** Parsed token usage for one assistant response. */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheHitTokens?: number
  price?: string
  currency?: string
}

/**
 * Defensively read the OpenAI/DeepSeek-shaped usage object off an assistant
 * node. The runtime stores it as `unknown`, so tolerate missing/renamed fields.
 */
export function parseUsage(raw: unknown): TokenUsage | null {
  if (raw === null || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
  const prompt = num(u.prompt_tokens)
  const completion = num(u.completion_tokens)
  const total = num(u.total_tokens)
  if (prompt === undefined && completion === undefined && total === undefined) return null
  let cache: number | undefined
  const details = u.prompt_tokens_details
  if (details !== null && typeof details === 'object') {
    cache = num((details as Record<string, unknown>).cached_tokens)
  }
  let price: string | undefined
  if (typeof u.total_price === 'string' || typeof u.total_price === 'number') price = String(u.total_price)
  const currency = typeof u.currency === 'string' ? u.currency : undefined
  const usage: TokenUsage = {
    promptTokens: prompt ?? 0,
    completionTokens: completion ?? 0,
    totalTokens: total ?? (prompt ?? 0) + (completion ?? 0),
  }
  if (cache !== undefined) usage.cacheHitTokens = cache
  if (price !== undefined) usage.price = price
  if (currency !== undefined) usage.currency = currency
  return usage
}

/** Cumulative token usage across assistant messages, optionally scoped to one provider. */
export interface UsageSummary {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  count: number
}

interface AssistantLike {
  kind?: string
  provenance?: { provider?: string; model?: string }
  requestConfig?: { provider?: string; model?: string }
  usage?: unknown
}

/**
 * Sum token usage from a conversation snapshot. When `spec` is provided, only
 * assistant messages belonging to that provider (matched by provider/model) are
 * counted, so the panel can attribute usage to the model currently in use.
 */
export function sumUsage(snapshot: ConversationSnapshot | undefined, spec: ProviderSpec | null): UsageSummary {
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0
  let count = 0
  for (const node of snapshot?.nodes ?? []) {
    if (node.kind !== 'assistant') continue
    const a = node as AssistantLike
    const provider = a.provenance?.provider ?? a.requestConfig?.provider
    const model = a.provenance?.model ?? a.requestConfig?.model
    if (spec !== null && !spec.match(provider, model)) continue
    const parsed = parseUsage(a.usage)
    if (parsed === null) continue
    promptTokens += parsed.promptTokens
    completionTokens += parsed.completionTokens
    totalTokens += parsed.totalTokens
    count += 1
  }
  return { promptTokens, completionTokens, totalTokens, count }
}
