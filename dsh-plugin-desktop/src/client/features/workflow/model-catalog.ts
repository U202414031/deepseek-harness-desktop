/**
 * Chat endpoints for the workflow runner.
 *
 * 设计目标：工作流节点能调用「任意可通过 API 访问的对话/补全模型」。
 * - `PROVIDER_ENDPOINTS` 是手工策展的服务商清单，覆盖主流厂家的 chat 兼容端点，
 *   并把每个厂家的常见模型版本列成「预设建议」。
 * - 节点里的「模型」字段是**自由文本**：预设只是下拉建议，用户想填什么就填什么
 *   （例如 `deepseek-reasoner`、`qwen3-235b-a22b`、`glm-4.5`、`doubao-seed-1.6`、
 *   `abab6.5s-chat`、OpenRouter 的 `anthropic/claude-3.7-sonnet` 等）。
 * - 两家「自定义」条目让任意 OpenAI / Anthropic 兼容网关都能接入：用户粘贴自己的
 *   API 地址 + 模型名即可。
 *
 * 注意：本节点是「对话 / 文本补全」节点，走 OpenAI / Anthropic 的 chat 协议。
 * 视频生成（如 Seedance）、语音合成等走的是另一套生成协议，需要单独的节点类型，
 * 当前版本不在此处支持。
 */

/** Wire protocol used when talking to a provider. */
export type ChatWireStyle = 'openai' | 'anthropic'

/** One selectable provider in the node inspector. */
export interface ProviderEndpoint {
  /** Provider id, stored on the node's config. */
  id: string
  /** Human-facing provider name. */
  label: string
  /** Absolute chat URL used when the node has no custom base URL. */
  url: string
  /** Request/response shape of the endpoint. */
  style: ChatWireStyle
  /** Preset model ids offered as suggestions (the model field is still free text). */
  models: readonly string[]
  /**
   * Which API 设置里的服务商 key 可复用。等于 `id` 表示复用同名的已存 key；
   * 留空表示本服务商不在 API 设置面板里，节点须自己填 key。
   */
  keyProviderId?: string
  /** 一句话提示，帮助理解这个服务商填什么。 */
  hint?: string
}

/** Provider used when a node has no explicit selection. */
export const DEFAULT_PROVIDER_ID = 'deepseek'

/**
 * 策展的服务商清单。顺序即下拉顺序。
 * url 为空代表「必须由节点填写自定义 API 地址」的自定义条目。
 */
export const PROVIDER_ENDPOINTS: readonly ProviderEndpoint[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    url: 'https://api.deepseek.com/chat/completions',
    style: 'openai',
    keyProviderId: 'deepseek',
    hint: '例如 deepseek-chat / deepseek-reasoner / deepseek-coder',
    models: [
      'deepseek-chat',
      'deepseek-reasoner',
      'deepseek-coder',
      'deepseek-lite',
      'deepseek-v3',
      'deepseek-r1',
    ],
  },
  {
    id: 'qwen',
    label: '通义千问 Qwen',
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    style: 'openai',
    keyProviderId: 'qwen',
    hint: '支持全系 qwen / qwen2.5 / qwen3 与多模态模型 ID',
    models: [
      'qwen-max',
      'qwen-max-latest',
      'qwen-plus',
      'qwen-turbo',
      'qwen-long',
      'qwen2.5-72b-instruct',
      'qwen2.5-32b-instruct',
      'qwen2.5-14b-instruct',
      'qwen2.5-7b-instruct',
      'qwen3-235b-a22b',
      'qwen3-32b',
      'qwen3-14b',
      'qwen3-8b',
      'qwen-vl-max',
      'qwen-audio-turbo',
    ],
  },
  {
    id: 'doubao',
    label: '豆包 / 火山方舟',
    url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    style: 'openai',
    hint: '在火山方舟获取 Endpoint ID，填到「模型」里（如 ep-xxxx 或 doubao-seed-1.6）',
    models: [
      'doubao-seed-1.6-250615',
      'doubao-pro-32k',
      'doubao-pro-128k-240515',
      'doubao-lite-32k',
      'doubao-1.5-pro-32k',
      'doubao-vision-pro',
    ],
  },
  {
    id: 'moonshot',
    label: 'Kimi / 月之暗面',
    url: 'https://api.moonshot.cn/v1/chat/completions',
    style: 'openai',
    keyProviderId: 'moonshot',
    hint: 'kimi 系列与 moonshot-v1 系列',
    models: [
      'kimi-latest',
      'kimi-k2',
      'kimi-k2-thinking',
      'moonshot-v1-8k',
      'moonshot-v1-32k',
      'moonshot-v1-128k',
    ],
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    style: 'openai',
    keyProviderId: 'zhipu',
    hint: 'glm-4 全系、glm-4.5、charglm、cogview 等',
    models: [
      'glm-4-plus',
      'glm-4',
      'glm-4-air',
      'glm-4-flash',
      'glm-4-long',
      'glm-4v',
      'glm-4v-plus',
      'glm-4.5',
      'glm-4.5-air',
      'glm-4.5v',
      'charglm-3',
      'cogview-4',
    ],
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    url: 'https://api.minimax.io/v1/chat/completions',
    style: 'openai',
    hint: '文本对话模型 abab / MiniMax-Text 系列',
    models: [
      'abab6.5s-chat',
      'abab6.5t-chat',
      'abab5.5s-chat',
      'MiniMax-Text-01',
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    style: 'openai',
    keyProviderId: 'openrouter',
    hint: '可用「厂商/模型」格式，如 anthropic/claude-3.7-sonnet',
    models: [
      'deepseek/deepseek-chat',
      'openai/gpt-4o-mini',
      'anthropic/claude-3.7-sonnet',
      'google/gemini-2.0-flash-001',
      'meta-llama/llama-3.3-70b-instruct',
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    style: 'openai',
    keyProviderId: 'openai',
    models: [
      'gpt-4o-mini',
      'gpt-4o',
      'gpt-4.1',
      'o3-mini',
      'o4-mini',
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    url: 'https://api.anthropic.com/v1/messages',
    style: 'anthropic',
    keyProviderId: 'anthropic',
    models: [
      'claude-3-5-sonnet-latest',
      'claude-3-5-haiku-latest',
      'claude-3-7-sonnet-latest',
      'claude-sonnet-4-0',
    ],
  },
  {
    id: 'custom-openai',
    label: '自定义（OpenAI 兼容）',
    url: '',
    style: 'openai',
    hint: '粘贴任意 OpenAI 兼容的 API 地址，例如 https://your-host/v1 或完整 chat 地址',
    models: [],
  },
  {
    id: 'custom-anthropic',
    label: '自定义（Anthropic 兼容）',
    url: '',
    style: 'anthropic',
    hint: '粘贴任意 Anthropic 兼容的 API 地址，例如 https://your-host/v1',
    models: [],
  },
]

/** @returns the endpoint for a provider id, or undefined when unsupported. */
export function findEndpoint(providerId: string): ProviderEndpoint | undefined {
  return PROVIDER_ENDPOINTS.find((entry) => entry.id === providerId)
}

/** @returns the endpoint for a provider id, falling back to the default provider. */
export function resolveEndpoint(providerId: string): ProviderEndpoint {
  const picked = findEndpoint(providerId) ?? findEndpoint(DEFAULT_PROVIDER_ID)
  if (picked === undefined) throw new Error('工作流：没有可用的模型服务商配置')
  return picked
}

/**
 * Resolve the chat URL for a node.
 * @param endpoint - provider endpoint selected by the node.
 * @param override - user-entered base URL; may be a full chat URL, an
 *        OpenAI-style `/v1` base, a bare origin, or empty (use `endpoint.url`).
 * @returns the absolute URL the runner should POST to.
 */
export function resolveChatUrl(endpoint: ProviderEndpoint, override: string): string {
  const custom = override.trim().replace(/\/+$/, '')
  if (custom.length === 0) return endpoint.url
  // Already a concrete chat endpoint.
  if (/\/(chat\/completions|messages)$/.test(custom)) return custom
  // An OpenAI-compatible base such as `https://host/v1`.
  if (/\/v\d+$/.test(custom)) return `${custom}${endpoint.style === 'anthropic' ? '/messages' : '/chat/completions'}`
  // A bare origin (or unknown gateway) — append the provider's known path when
  // available, otherwise infer a sane default from the wire style.
  const known = endpoint.url.replace(/\/+$/, '').match(/\/(chat\/completions|messages)$/)
  const path = known !== null ? known[0] : (endpoint.style === 'anthropic' ? '/v1/messages' : '/v1/chat/completions')
  return `${custom}${path}`
}

/** @returns the first preset model of a provider, or an empty string. */
export function defaultModelFor(providerId: string): string {
  return findEndpoint(providerId)?.models[0] ?? ''
}
