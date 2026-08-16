import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

/** A model provider the API panel knows how to talk to. */
export interface ProviderSpec {
  /** Stable id used as a localStorage key suffix and internal routing. */
  id: string
  /** Human-facing name shown in the UI. */
  label: string
  /** Short origin note shown under the provider name. */
  hint: string
  /** Base URL for the provider's REST API (used for balance queries). */
  baseUrl: string
  /** Balance endpoint path appended to baseUrl. Empty when unsupported. */
  balancePath: string
  /** Whether the provider exposes a key-authenticated balance endpoint. */
  balanceSupported: boolean
  /** URL the user is sent to for topping up / recharging. */
  rechargeUrl: string
  /** URL for managing the provider's API keys. */
  apiKeyUrl: string
  /**
   * Match a (provider, model) pair reported by the host. Returns true when this
   * spec applies; must tolerate undefined inputs.
   */
  match(provider: string | undefined, model: string | undefined): boolean
}

const DEEPSEEK: ProviderSpec = {
  id: 'deepseek',
  label: 'DeepSeek',
  hint: '深度求索',
  baseUrl: 'https://api.deepseek.com',
  balancePath: '/user/balance',
  balanceSupported: true,
  rechargeUrl: 'https://platform.deepseek.com/top_up',
  apiKeyUrl: 'https://platform.deepseek.com/api_keys',
  match: (provider, model) =>
    provider === 'deepseek-official' ||
    provider === 'deepseek' ||
    (model?.startsWith('deepseek') ?? false),
}

const QWEN: ProviderSpec = {
  id: 'qwen',
  label: '通义千问 (Qwen)',
  hint: '阿里云百炼 / DashScope',
  baseUrl: 'https://dashscope.aliyuncs.com',
  balancePath: '',
  balanceSupported: false,
  rechargeUrl: 'https://bailian.console.aliyun.com/',
  apiKeyUrl: 'https://bailian.console.aliyun.com/?tab=account',
  match: (provider, model) =>
    provider === 'qwen' ||
    provider === 'qwen-official' ||
    provider === 'dashscope' ||
    (model?.startsWith('qwen') ?? false),
}

/** Known providers, in display order. Extend here to support more vendors. */
export const PROVIDERS: readonly ProviderSpec[] = [DEEPSEEK, QWEN]

/** Resolve the provider spec for a reported (provider, model) pair. */
export function detectProvider(provider: string | undefined, model: string | undefined): ProviderSpec | null {
  for (const spec of PROVIDERS) {
    if (spec.match(provider, model)) return spec
  }
  return null
}

interface AssistantLike {
  kind?: string
  provenance?: { provider?: string; model?: string }
  requestConfig?: { provider?: string; model?: string }
}

/** Extract the provider/model of the most recent assistant message. */
export function detectCurrentModel(snapshot: ConversationSnapshot | undefined): {
  provider: string | undefined
  model: string | undefined
  spec: ProviderSpec | null
} {
  const nodes = [...(snapshot?.nodes ?? [])].reverse()
  const last = nodes.find((n) => n.kind === 'assistant') as AssistantLike | undefined
  const provider = last?.provenance?.provider ?? last?.requestConfig?.provider
  const model = last?.provenance?.model ?? last?.requestConfig?.model
  return { provider, model, spec: detectProvider(provider, model) }
}
