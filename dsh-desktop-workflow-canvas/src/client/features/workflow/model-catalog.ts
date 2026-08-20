/**
 * Chat endpoints + generation models for the workflow runner.
 *
 * 设计目标：工作流节点能调用「任意可通过 API 访问的模型」。
 * - `PROVIDER_ENDPOINTS` 是手工策展的服务商清单，覆盖国内外主流厂家（DeepSeek、通义千问/阿里云百炼、
 *   智谱 GLM、月之暗面 Kimi、MiniMax、豆包/火山方舟、腾讯混元、百度文心、讯飞星火、百川、零一万物、
 *   阶跃星辰、商汤、华为盘古，以及 OpenAI / Anthropic / Google / Mistral / xAI / Perplexity / Cohere / Meta，
 *   外加硅基流动、PPIO、OpenRouter 等聚合平台）。
 * - 每个厂家的常见模型版本列成「预设建议」，每条带「友好显示名 + 真实 API id + 模态(category)」。
 *   模型清单已对齐到 2026 年各厂家当前真实 API 模型 ID（数据来源：各家官方文档）。
 * - 节点里的「模型」字段是**自由文本**：下拉只是建议，用户想填什么就填什么
 *   （例如 `deepseek-v4-flash`、`glm-5.2`、`qwen3.8-max`、`doubao-seed-1.6`、`seedance-2.5`）。
 *
 * 关于模态(category)：
 * - `chat`：对话 / 文本补全，走 OpenAI / Anthropic 的 chat 协议，当前节点可直接调用。
 * - `image` / `video` / `audio`：图像 / 视频 / 语音生成，走各厂家专门的生成接口，
 *   当前「对话节点」暂不支持调用（选了会在运行时报错）。这些模型列在这里是为了「看得见、查得到」，
 *   后续版本会加独立的「生成节点」来真正调用它们。节点里选到非 chat 模型时界面会给出明显提示。
 */

/** Wire protocol used when talking to a provider. */
export type ChatWireStyle = 'openai' | 'anthropic'

/** Model modality. Only `chat` is callable by the current conversation node. */
export type ModelCategory = 'chat' | 'image' | 'video' | 'audio'

/** One selectable preset model: a friendly label plus the exact API id. */
export interface ModelOption {
  /** Exact model string sent as `model` to the API (e.g. `deepseek-v4-flash`). */
  id: string
  /** Human-facing name shown in the dropdown. */
  label: string
  /** Modality of this model; omitted means `chat`. */
  category?: ModelCategory
}

/** One selectable provider in the node inspector. */
export interface ProviderEndpoint {
  /** Provider id, stored on the node's config. */
  id: string
  /** Human-facing provider name. */
  label: string
  /** Absolute chat URL used when the node has no custom base URL. Empty = must fill custom URL. */
  url: string
  /** Request/response shape of the endpoint. */
  style: ChatWireStyle
  /** Preset model options offered as suggestions (the model field is still free text). */
  models: readonly ModelOption[]
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
 * url 为空代表「必须由节点填写自定义 API 地址」的自定义条目，或企业私有接入点（如华为盘古）。
 */
export const PROVIDER_ENDPOINTS: readonly ProviderEndpoint[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek（深度求索）',
    url: 'https://api.deepseek.com/chat/completions',
    style: 'openai',
    keyProviderId: 'deepseek',
    hint: '模型填官网 API 的真实模型名，如 deepseek-v4-flash / deepseek-v4-pro / deepseek-r1。',
    models: [
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash（高速低成本）' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro（高性能推理）' },
      { id: 'deepseek-v4-flash-202605', label: 'DeepSeek V4 Flash · 2026-05 版' },
      { id: 'deepseek-v4-pro-202606', label: 'DeepSeek V4 Pro · 2026-06 版' },
      { id: 'deepseek-v3.2', label: 'DeepSeek V3.2' },
      { id: 'deepseek-v3.1', label: 'DeepSeek V3.1' },
      { id: 'deepseek-r1', label: 'DeepSeek R1（深度推理）' },
      { id: 'deepseek-chat', label: 'DeepSeek Chat（旧版兼容）' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner（旧版推理）' },
    ],
  },
  {
    id: 'qwen',
    label: '通义千问 Qwen（阿里云百炼）',
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    style: 'openai',
    keyProviderId: 'qwen',
    hint: '阿里云百炼控制台可查完整模型名。覆盖 Qwen3.5 ~ 3.8 全系（Max / Plus / Flash / Turbo / Coder / 视觉 / 全模态 / 数学 / 翻译），以及图像生成 Qwen-Image、视频生成 Wan 系列。',
    models: [
      // —— 对话 / 文本 ——
      { id: 'qwen3.8-max', label: 'Qwen3.8-Max（旗舰）' },
      { id: 'qwen3.7-max', label: 'Qwen3.7-Max' },
      { id: 'qwen3.7-max-us', label: 'Qwen3.7-Max（美国区）' },
      { id: 'qwen3.6-max-preview', label: 'Qwen3.6-Max-Preview' },
      { id: 'qwen3-max', label: 'Qwen3-Max' },
      { id: 'qwen-max', label: 'Qwen-Max（经典旗舰）' },
      { id: 'qwen3.7-plus', label: 'Qwen3.7-Plus' },
      { id: 'qwen3.6-plus', label: 'Qwen3.6-Plus' },
      { id: 'qwen3.5-plus', label: 'Qwen3.5-Plus' },
      { id: 'qwen-plus', label: 'Qwen-Plus' },
      { id: 'qwen3.8-flash', label: 'Qwen3.8-Flash（高速）' },
      { id: 'qwen3.7-flash', label: 'Qwen3.7-Flash' },
      { id: 'qwen3.6-flash', label: 'Qwen3.6-Flash' },
      { id: 'qwen3.5-flash', label: 'Qwen3.5-Flash' },
      { id: 'qwen-flash', label: 'Qwen-Flash' },
      { id: 'qwen-turbo', label: 'Qwen-Turbo（极速）' },
      { id: 'qwq-plus', label: 'QwQ-Plus（推理）' },
      { id: 'qwen-long', label: 'Qwen-Long（超长上下文）' },
      { id: 'qwen-math-plus', label: 'Qwen-Math-Plus（数学）' },
      { id: 'qwen3-coder-plus', label: 'Qwen3-Coder-Plus（代码）' },
      { id: 'qwen3-coder-flash', label: 'Qwen3-Coder-Flash（代码）' },
      { id: 'qwen-mt-plus', label: 'Qwen-MT-Plus（翻译）' },
      { id: 'qwen3.5-omni-plus', label: 'Qwen3.5-Omni-Plus（全模态）' },
      { id: 'qwen3-vl-plus', label: 'Qwen3-VL-Plus（视觉理解）' },
      { id: 'qwen3-235b-a22b', label: 'Qwen3-235B-A22B（开源）' },
      { id: 'qwen3-32b', label: 'Qwen3-32B（开源）' },
      { id: 'qwen3-14b', label: 'Qwen3-14B（开源）' },
      { id: 'qwen3-8b', label: 'Qwen3-8B（开源）' },
      // —— 图像生成 ——
      { id: 'qwen-image-max', label: '【图像】Qwen-Image-Max（通义万相旗舰）', category: 'image' },
      { id: 'qwen-image-plus', label: '【图像】Qwen-Image-Plus（通义万相）', category: 'image' },
      { id: 'qwen-image', label: '【图像】Qwen-Image（通义万相）', category: 'image' },
      { id: 'qwen-image-edit', label: '【图像】Qwen-Image-Edit（通义万相重绘）', category: 'image' },
      // —— 视频生成 ——
      { id: 'wan2.2-t2v', label: '【视频】Wan2.2-T2V（通义万相视频）', category: 'video' },
      { id: 'wan2.2-i2v', label: '【视频】Wan2.2-I2V（通义万相视频）', category: 'video' },
      { id: 'wan2.1-t2v', label: '【视频】Wan2.1-T2V（通义万相视频）', category: 'video' },
    ],
  },
  {
    id: 'zhipu',
    label: '智谱 GLM（Zhipu AI）',
    url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    style: 'openai',
    keyProviderId: 'zhipu',
    hint: '智谱 GLM 全系，含 GLM-5 与 GLM-4 系列，模型名以智谱开放平台为准；另有 CogVideo（视频）/ CogView（图像）。',
    models: [
      { id: 'glm-5.2', label: 'GLM-5.2（最新旗舰）' },
      { id: 'glm-5.2-fast-preview', label: 'GLM-5.2-Fast-Preview' },
      { id: 'glm-5.2-us', label: 'GLM-5.2（美国区）' },
      { id: 'glm-5.1', label: 'GLM-5.1' },
      { id: 'glm-5', label: 'GLM-5' },
      { id: 'glm-5-turbo', label: 'GLM-5-Turbo（高速）' },
      { id: 'glm-5v', label: 'GLM-5V（视觉）' },
      { id: 'glm-4.7', label: 'GLM-4.7' },
      { id: 'glm-4.6', label: 'GLM-4.6' },
      { id: 'glm-4-flash', label: 'GLM-4-Flash（免费）' },
      { id: 'glm-4-air', label: 'GLM-4-Air' },
      { id: 'charglm-3', label: 'CharGLM-3（角色对话）' },
      { id: 'cogview-4', label: '【图像】CogView-4（文生图）', category: 'image' },
      { id: 'cogvideox-2', label: '【视频】CogVideoX-2（文生视频）', category: 'video' },
      { id: 'cogvideox-flash', label: '【视频】CogVideoX-Flash（文生视频）', category: 'video' },
    ],
  },
  {
    id: 'moonshot',
    label: 'Kimi / 月之暗面',
    url: 'https://api.moonshot.cn/v1/chat/completions',
    style: 'openai',
    keyProviderId: 'moonshot',
    hint: 'kimi 系列与 moonshot-v1 系列，模型名以官网文档为准。',
    models: [
      { id: 'kimi-k3', label: 'Kimi K3（旗舰多模态）' },
      { id: 'kimi-k2.7-code', label: 'Kimi K2.7-Code（代码）' },
      { id: 'kimi-k2.6', label: 'Kimi K2.6' },
      { id: 'kimi-k2.5', label: 'Kimi K2.5' },
      { id: 'Moonshot-Kimi-K2-Instruct', label: 'Kimi-K2-Instruct（开源）' },
      { id: 'kimi-k2-thinking', label: 'Kimi-K2-Thinking（推理）' },
      { id: 'moonshot-v1-8k', label: 'Moonshot-V1-8K' },
      { id: 'moonshot-v1-32k', label: 'Moonshot-V1-32K' },
      { id: 'moonshot-v1-128k', label: 'Moonshot-V1-128K（长上下文）' },
    ],
  },
  {
    id: 'minimax',
    label: 'MiniMax（稀宇）',
    url: 'https://api.minimax.io/v1/chat/completions',
    style: 'openai',
    hint: '文本对话模型 MiniMax-M 系与 ABAB 系；视频生成 MiniMax-H 系 / video-01，图像生成 MiniMax-Image。',
    models: [
      // —— 对话 / 文本 ——
      { id: 'minimax-m3', label: 'MiniMax-M3（最新）' },
      { id: 'minimax-m2.7', label: 'MiniMax-M2.7' },
      { id: 'minimax-m2.5', label: 'MiniMax-M2.5' },
      { id: 'MiniMax-Text-01', label: 'MiniMax-Text-01（超长上下文）' },
      { id: 'abab6.5s-chat', label: 'ABAB6.5S-Chat' },
      { id: 'abab6.5t-chat', label: 'ABAB6.5T-Chat' },
      // —— 视频生成 ——
      { id: 'minimax-h3', label: '【视频】MiniMax-H3（视频生成旗舰）', category: 'video' },
      { id: 'minimax-h2', label: '【视频】MiniMax-H2（视频生成）', category: 'video' },
      { id: 'MiniMax-Video-01', label: '【视频】MiniMax-Video-01（文生视频）', category: 'video' },
      { id: 'MiniMax-T2V-01', label: '【视频】MiniMax-T2V-01（文生视频）', category: 'video' },
      { id: 'MiniMax-I2V-01', label: '【视频】MiniMax-I2V-01（图生视频）', category: 'video' },
      // —— 图像生成 ——
      { id: 'MiniMax-Image-01', label: '【图像】MiniMax-Image-01（文生图）', category: 'image' },
    ],
  },
  {
    id: 'doubao',
    label: '豆包 / 火山方舟（字节跳动）',
    url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    style: 'openai',
    hint: '在火山方舟创建推理接入点后，把「接入点 ID」（形如 ep-xxxx）填到「模型」里；下方也列出可直接用的豆包对话模型名。Seedance（视频）/ Seedream（图像）走专门生成接口，当前对话节点暂不支持，列在下方「生成模型」里备查。',
    models: [
      // —— 对话 / 文本 ——
      { id: 'doubao-seed-1.6', label: '豆包 Seed-1.6（对话）' },
      { id: 'doubao-seed-1.6-flash', label: '豆包 Seed-1.6-Flash（高速）' },
      { id: 'doubao-seed-1.6-thinking', label: '豆包 Seed-1.6-Thinking（推理）' },
      { id: 'doubao-1.5-pro-32k', label: '豆包 1.5-Pro-32K' },
      { id: 'doubao-1.5-lite', label: '豆包 1.5-Lite' },
      { id: 'doubao-pro-32k', label: '豆包 Pro-32K' },
      { id: 'doubao-lite-32k', label: '豆包 Lite-32K' },
      { id: 'doubao-vision-pro', label: '豆包 Vision-Pro（视觉）' },
      // —— 视频生成 ——
      { id: 'seedance-2.5', label: '【视频】Seedance 2.5（豆包视频旗舰）', category: 'video' },
      { id: 'seedance-2.0', label: '【视频】Seedance 2.0（豆包视频）', category: 'video' },
      { id: 'seedance-1.5-pro', label: '【视频】Seedance 1.5-Pro（豆包视频）', category: 'video' },
      { id: 'seedance-1.5-lite', label: '【视频】Seedance 1.5-Lite（豆包视频）', category: 'video' },
      // —— 图像生成 ——
      { id: 'seedream-3.0', label: '【图像】Seedream 3.0（豆包图像旗舰）', category: 'image' },
      { id: 'seedream-2.0', label: '【图像】Seedream 2.0（豆包图像）', category: 'image' },
      { id: 'seedream-vg', label: '【图像】Seedream-VG（豆包图像/参考图）', category: 'image' },
    ],
  },
  {
    id: 'hunyuan',
    label: '腾讯混元（Tencent）',
    url: 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions',
    style: 'openai',
    hint: '腾讯混元全系，模型名以腾讯云文档为准。',
    models: [
      { id: 'hunyuan-turbo-latest', label: '混元 Turbo-Latest' },
      { id: 'hunyuan-turbo', label: '混元 Turbo' },
      { id: 'hunyuan-large', label: '混元 Large' },
      { id: 'hunyuan-pro', label: '混元 Pro' },
      { id: 'hunyuan-standard-256K', label: '混元 Standard-256K' },
      { id: 'hunyuan-standard', label: '混元 Standard' },
      { id: 'hunyuan-lite', label: '混元 Lite（免费）' },
      { id: 'hunyuan-vision', label: '混元 Vision（视觉）' },
      { id: 'hunyuan-a13b', label: '混元 A13B（开源）' },
      { id: 'hunyuan-t1', label: '混元 T1（推理）' },
    ],
  },
  {
    id: 'baidu',
    label: '百度文心 ERNIE（千帆）',
    url: 'https://qianfan.baidubce.com/v2/chat/completions',
    style: 'openai',
    hint: '百度智能云千帆平台，模型名以千帆文档为准（OpenAI 兼容）。',
    models: [
      { id: 'ernie-5.0-8k', label: 'ERNIE 5.0（旗舰）' },
      { id: 'ernie-4.5-8k', label: 'ERNIE 4.5-8K' },
      { id: 'ernie-4.5-turbo-32k', label: 'ERNIE 4.5-Turbo-32K' },
      { id: 'ernie-4.5-turbo', label: 'ERNIE 4.5-Turbo' },
      { id: 'ernie-speed-128k', label: 'ERNIE-Speed-128K（免费）' },
      { id: 'ernie-lite-8k', label: 'ERNIE-Lite-8K（免费）' },
      { id: 'ernie-4.0-8k', label: 'ERNIE 4.0-8K' },
      { id: 'ernie-x1', label: 'ERNIE X1（推理）' },
    ],
  },
  {
    id: 'xfyun',
    label: '讯飞星火（iFlytek）',
    url: 'https://spark-api-open.xf-yun.com/v1/chat/completions',
    style: 'openai',
    hint: '讯飞开放平台星火大模型，模型名以讯飞文档为准（OpenAI 兼容）。',
    models: [
      { id: 'generalv3.5', label: '星火 V3.5' },
      { id: '4.0Ultra', label: '星火 4.0 Ultra' },
      { id: 'max-32k', label: '星火 Max-32K' },
      { id: 'pro-128k', label: '星火 Pro-128K' },
      { id: 'generalv3', label: '星火 V3' },
      { id: 'lite', label: '星火 Lite（免费）' },
    ],
  },
  {
    id: 'baichuan',
    label: '百川智能（Baichuan）',
    url: 'https://api.baichuan-ai.com/v1/chat/completions',
    style: 'openai',
    hint: '百川大模型，模型名以百川开放平台为准。',
    models: [
      { id: 'Baichuan4-Turbo', label: 'Baichuan4-Turbo' },
      { id: 'Baichuan4-Air', label: 'Baichuan4-Air' },
      { id: 'Baichuan4', label: 'Baichuan4' },
      { id: 'Baichuan3-Turbo', label: 'Baichuan3-Turbo' },
      { id: 'Baichuan3-Turbo-128k', label: 'Baichuan3-Turbo-128K' },
      { id: 'Baichuan2-Turbo', label: 'Baichuan2-Turbo' },
    ],
  },
  {
    id: 'yi',
    label: '零一万物 01.AI（Yi）',
    url: 'https://api.lingyiwanwu.com/v1/chat/completions',
    style: 'openai',
    hint: '零一万物 Yi 系列，模型名以官方文档为准。',
    models: [
      { id: 'yi-lightning', label: 'Yi-Lightning（高速）' },
      { id: 'yi-large', label: 'Yi-Large' },
      { id: 'yi-large-turbo', label: 'Yi-Large-Turbo' },
      { id: 'yi-medium', label: 'Yi-Medium' },
      { id: 'yi-medium-200k', label: 'Yi-Medium-200K' },
      { id: 'yi-spark', label: 'Yi-Spark' },
      { id: 'yi-large-rag', label: 'Yi-Large-RAG' },
      { id: 'yi-large-fc', label: 'Yi-Large-FC（函数调用）' },
    ],
  },
  {
    id: 'step',
    label: '阶跃星辰（StepFun）',
    url: 'https://api.stepfun.com/v1/chat/completions',
    style: 'openai',
    hint: '阶跃星辰 Step 系列，模型名以官方文档为准。',
    models: [
      { id: 'step-3.7-flash', label: 'Step-3.7-Flash' },
      { id: 'step-1-flash', label: 'Step-1-Flash（高速）' },
      { id: 'step-1-8k', label: 'Step-1-8K' },
      { id: 'step-1-32k', label: 'Step-1-32K' },
      { id: 'step-1-128k', label: 'Step-1-128K' },
      { id: 'step-1-256k', label: 'Step-1-256K' },
      { id: 'step-2-16k', label: 'Step-2-16K' },
    ],
  },
  {
    id: 'sensenova',
    label: '商汤 商量（SenseNova）',
    url: 'https://api.sensenova.cn/v1/chat/completions',
    style: 'openai',
    hint: '商汤日日新 SenseNova 系列，模型名以商汤文档为准。',
    models: [
      { id: 'sensechat-5', label: 'SenseChat-5（旗舰）' },
      { id: 'sensechat-pro', label: 'SenseChat-Pro' },
      { id: 'sensechat-lite', label: 'SenseChat-Lite' },
      { id: 'sensechat-128k', label: 'SenseChat-128K' },
      { id: 'SenseNova-V6-Turbo', label: 'SenseNova-V6-Turbo' },
      { id: 'SenseNova-V6.5', label: 'SenseNova-V6.5' },
    ],
  },
  {
    id: 'pangu',
    label: '华为盘古（Pangu）',
    url: '',
    style: 'openai',
    hint: '华为盘古主要面向企业私有化 / ModelArts 部署。请在企业控制台获取推理接入点地址，填到下方「自定义 API 地址」，并把模型 ID 填到「模型」里。',
    models: [
      { id: 'pangu-pro', label: 'Pangu Pro' },
      { id: 'pangu-large', label: 'Pangu Large' },
      { id: 'pangu-nlp', label: 'Pangu NLP' },
      { id: 'pangu-vision', label: 'Pangu Vision' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    style: 'openai',
    keyProviderId: 'openai',
    hint: 'OpenAI 官方模型，如 gpt-5.6 / gpt-4o / o4-mini；另有 Sora（视频）/ gpt-image（图像）。',
    models: [
      { id: 'gpt-5.6', label: 'GPT-5.6（旗舰）' },
      { id: 'gpt-5.5', label: 'GPT-5.5' },
      { id: 'gpt-5.2', label: 'GPT-5.2' },
      { id: 'gpt-4o', label: 'GPT-4o（多模态）' },
      { id: 'o4-mini', label: 'o4-mini（推理）' },
      { id: 'o3-mini', label: 'o3-mini（推理）' },
      { id: 'sora', label: '【视频】Sora（文生视频）', category: 'video' },
      { id: 'sora-2', label: '【视频】Sora 2（文生视频）', category: 'video' },
      { id: 'gpt-image-1', label: '【图像】GPT-Image-1（文生图）', category: 'image' },
      { id: 'dall-e-3', label: '【图像】DALL·E 3（文生图）', category: 'image' },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    url: 'https://api.anthropic.com/v1/messages',
    style: 'anthropic',
    keyProviderId: 'anthropic',
    hint: 'Claude 系列，如 claude-opus-4-8 / claude-sonnet-5。',
    models: [
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8（旗舰）' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
      { id: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet' },
      { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
    ],
  },
  {
    id: 'google',
    label: 'Google Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    style: 'openai',
    hint: 'Gemini 的 OpenAI 兼容端点，模型名如 gemini-3.1-pro；另有 Veo（视频）/ Imagen（图像）。',
    models: [
      { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro（旗舰）' },
      { id: 'gemini-3-pro', label: 'Gemini 3 Pro' },
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'veo-3', label: '【视频】Veo 3（文生视频）', category: 'video' },
      { id: 'veo-2', label: '【视频】Veo 2（文生视频）', category: 'video' },
      { id: 'imagen-4', label: '【图像】Imagen 4（文生图）', category: 'image' },
      { id: 'imagen-3', label: '【图像】Imagen 3（文生图）', category: 'image' },
    ],
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    url: 'https://api.mistral.ai/v1/chat/completions',
    style: 'openai',
    hint: 'Mistral 官方模型，如 mistral-large / codestral。',
    models: [
      { id: 'mistral-large-latest', label: 'Mistral Large（旗舰）' },
      { id: 'mistral-8b-latest', label: 'Mistral 8B（小模型）' },
      { id: 'codestral-latest', label: 'Codestral（代码）' },
      { id: 'ministral-8b', label: 'Ministral 8B（端侧）' },
    ],
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    url: 'https://api.x.ai/v1/chat/completions',
    style: 'openai',
    hint: 'xAI 的 Grok 系列，OpenAI 兼容。',
    models: [
      { id: 'grok-4', label: 'Grok 4（旗舰）' },
      { id: 'grok-4-fast', label: 'Grok 4 Fast' },
      { id: 'grok-3', label: 'Grok 3' },
      { id: 'grok-3-mini', label: 'Grok 3 Mini' },
    ],
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    url: 'https://api.perplexity.ai/chat/completions',
    style: 'openai',
    hint: 'Perplexity 搜索增强对话模型，OpenAI 兼容。',
    models: [
      { id: 'sonar', label: 'Sonar（搜索增强）' },
      { id: 'sonar-pro', label: 'Sonar Pro（搜索增强）' },
      { id: 'sonar-reasoning', label: 'Sonar Reasoning（推理）' },
    ],
  },
  {
    id: 'cohere',
    label: 'Cohere',
    url: 'https://api.cohere.ai/v2/chat',
    style: 'openai',
    hint: 'Cohere 的 Command 系列，适合检索/企业场景。',
    models: [
      { id: 'command-r-plus', label: 'Command R+（旗舰）' },
      { id: 'command-r', label: 'Command R' },
      { id: 'command-a', label: 'Command A' },
    ],
  },
  {
    id: 'meta',
    label: 'Meta Llama',
    url: 'https://api.llama-api.com/v1/chat/completions',
    style: 'openai',
    hint: 'Meta 开源 Llama 系列，可通过官方 Llama API 或任意 OpenAI 兼容网关调用。',
    models: [
      { id: 'llama-4-maverick', label: 'Llama 4 Maverick' },
      { id: 'llama-4-scout', label: 'Llama 4 Scout' },
      { id: 'llama-3.3-70b', label: 'Llama 3.3 70B（开源）' },
      { id: 'llama-3.1-8b', label: 'Llama 3.1 8B（开源）' },
    ],
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    url: 'https://api.siliconflow.cn/v1/chat/completions',
    style: 'openai',
    hint: '聚合 100+ 开源模型（Qwen / DeepSeek / GLM / Llama 等），国内低延迟。模型名用「厂商/模型」格式。',
    models: [
      { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek-V3 (SiliconFlow)' },
      { id: 'Qwen/Qwen3-235B-A22B', label: 'Qwen3-235B (SiliconFlow)' },
      { id: 'Qwen/Qwen3-8B', label: 'Qwen3-8B (SiliconFlow)' },
      { id: 'zai-org/GLM-4.6', label: 'GLM-4.6 (SiliconFlow)' },
      { id: 'meta-llama/Llama-4-Maverick', label: 'Llama-4-Maverick (SiliconFlow)' },
      { id: 'THUDM/glm-4-9b-chat', label: 'GLM-4-9B (SiliconFlow)' },
    ],
  },
  {
    id: 'ppio',
    label: 'PPIO 派欧云',
    url: 'https://api.ppio.cn/v3/openai/chat/completions',
    style: 'openai',
    hint: 'PPIO 派欧云 OpenAI 兼容推理，模型名用「厂商/模型」格式（如 deepseek/deepseek-v4-flash）。',
    models: [
      { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash (PPIO)' },
      { id: 'qwen/qwen3.8-max', label: 'Qwen3.8-Max (PPIO)' },
      { id: 'qwen/qwen3.7-max', label: 'Qwen3.7-Max (PPIO)' },
      { id: 'meta/llama-4-maverick', label: 'Llama-4-Maverick (PPIO)' },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter（聚合）',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    style: 'openai',
    keyProviderId: 'openrouter',
    hint: '可用「厂商/模型」格式，如 anthropic/claude-opus-4-8、openai/gpt-5.6、google/gemini-3.1-pro、meta-llama/llama-4-maverick。',
    models: [
      { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash (OpenRouter)' },
      { id: 'openai/gpt-5.6', label: 'GPT-5.6 (OpenRouter)' },
      { id: 'anthropic/claude-opus-4-8', label: 'Claude Opus 4.8 (OpenRouter)' },
      { id: 'google/gemini-3.1-pro', label: 'Gemini 3.1 Pro (OpenRouter)' },
      { id: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick (OpenRouter)' },
      { id: 'mistralai/mistral-large', label: 'Mistral Large (OpenRouter)' },
      { id: 'x-ai/grok-4', label: 'Grok-4 (OpenRouter)' },
      { id: 'qwen/qwen3.8-max', label: 'Qwen3.8-Max (OpenRouter)' },
    ],
  },
  {
    id: 'custom-openai',
    label: '自定义（OpenAI 兼容）',
    url: '',
    style: 'openai',
    hint: '粘贴任意 OpenAI 兼容的 API 地址，例如 https://your-host/v1 或完整 chat 地址；「模型」填该服务要求的 model 字符串。',
    models: [],
  },
  {
    id: 'custom-anthropic',
    label: '自定义（Anthropic 兼容）',
    url: '',
    style: 'anthropic',
    hint: '粘贴任意 Anthropic 兼容的 API 地址，例如 https://your-host/v1；「模型」填该服务要求的 model 字符串。',
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

/** @returns the friendly label for a model id within a provider, falling back to the raw id. */
export function modelLabel(providerId: string, modelId: string): string {
  const endpoint = findEndpoint(providerId)
  const found = endpoint?.models.find((option) => option.id === modelId)
  return found?.label ?? modelId
}

/** @returns the modality of a model id within a provider, defaulting to `chat`. */
export function modelCategory(providerId: string, modelId: string): ModelCategory {
  const endpoint = findEndpoint(providerId)
  const found = endpoint?.models.find((option) => option.id === modelId)
  return found?.category ?? 'chat'
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

/** @returns the first preset chat model id of a provider, or an empty string. */
export function defaultModelFor(providerId: string): string {
  const endpoint = findEndpoint(providerId)
  if (endpoint === undefined) return ''
  const chat = endpoint.models.find((option) => (option.category ?? 'chat') === 'chat')
  return chat?.id ?? endpoint.models[0]?.id ?? ''
}
