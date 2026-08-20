import { getApiKey } from './api-key.ts'
import { proxyFetch } from '../../http-proxy.ts'

const DEEPSEEK_CHAT = 'https://api.deepseek.com/chat/completions'

interface ChatChoice {
  message?: { content?: string }
}

/**
 * Call DeepSeek chat completions using the user's configured DeepSeek key.
 * Returns null when no key is set or the request fails, so callers can fall
 * back to a local heuristic.
 */
async function deepseekChat(system: string, user: string): Promise<string | null> {
  const key = getApiKey('deepseek')
  if (!key) return null
  try {
    const response = await proxyFetch(DEEPSEEK_CHAT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        stream: false,
      }),
    })
    if (!response.ok) return null
    const data = await response.json() as { choices?: ChatChoice[] }
    const content = data.choices?.[0]?.message?.content
    return typeof content === 'string' ? content : null
  } catch {
    return null
  }
}

/** Summarize free text. Uses the DeepSeek key when available, else a local extract. */
export async function summarize(text: string): Promise<string> {
  const trimmed = text.trim()
  if (!trimmed) return '（没有可总结的内容）'
  const ai = await deepseekChat(
    '你是一个信息整理助手。请用简洁的中文要点总结以下内容，必要时分点列出，不要多余寒暄。',
    trimmed,
  )
  if (ai) return ai
  return localSummarize(trimmed)
}

/** Extract actionable task titles from free text. Uses DeepSeek when available. */
export async function extractTasks(text: string): Promise<string[]> {
  const trimmed = text.trim()
  if (!trimmed) return []
  const ai = await deepseekChat(
    '从以下内容中提取需要执行的任务或待办事项。只输出任务标题，每行一个，不要编号、不要解释。若没有明确任务则只输出一个空行。',
    trimmed,
  )
  if (ai) {
    return ai
      .split('\n')
      .map((line) => line.replace(/^[-*•\s]+/, '').trim())
      .filter((line) => line.length > 0)
  }
  return localExtract(trimmed)
}

function localSummarize(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0).slice(0, 12)
  const head = lines.slice(0, 6).join('\n')
  return `（本地摘要：未配置 DeepSeek API Key 时采用原始文本截取。如需 AI 总结，请在「API 设置」中填写 DeepSeek Key）\n\n${head}${lines.length > 6 ? '\n…' : ''}`
}

function localExtract(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) =>
        /^(todo|待办|任务|需要|请|记得|安排|跟进|task)/i.test(l) ||
        l.startsWith('- ') ||
        l.startsWith('* '),
    )
    .map((l) => l.replace(/^[-*•\s]+/, '').trim())
    .slice(0, 20)
}

/** A structured action the assistant resolves from a natural-language instruction. */
export interface AssistantAction {
  action: 'send' | 'task' | 'summarize' | 'unknown'
  platform?: 'feishu' | 'wechat' | 'qq'
  targetType?: string
  target?: string
  message?: string
  taskTitle?: string
}

/**
 * Parse a natural-language instruction into an executable tool action.
 * Uses DeepSeek when a key is configured, else a local keyword heuristic.
 */
export async function assistantCommand(text: string): Promise<AssistantAction> {
  const trimmed = text.trim()
  if (!trimmed) return { action: 'unknown' }
  const ai = await deepseekChat(
    '你是桌面工具助手。把用户的自然语言指令解析为一个 JSON 对象，只输出 JSON，不要任何解释或多余文字。\n' +
      '字段：action 取 "send"(发消息) | "task"(添加任务) | "summarize"(总结最近消息) | "unknown"；\n' +
      '可选 platform 取 "feishu" | "wechat" | "qq"；可选 target(目标会话/群/好友 id 或名称)、message(要发送的内容)、taskTitle(任务标题)。\n' +
      '示例：{"action":"send","platform":"qq","message":"今晚八点开会"}\n' +
      '示例：{"action":"task","taskTitle":"明天提交周报"}',
    trimmed,
  )
  if (ai) {
    const parsed = parseActionJson(ai)
    if (parsed) return parsed
  }
  return localCommand(trimmed)
}

function parseActionJson(text: string): AssistantAction | null {
  try {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    const action: AssistantAction['action'] =
      obj.action === 'send' || obj.action === 'task' || obj.action === 'summarize' ? obj.action : 'unknown'
    const result: AssistantAction = { action }
    if (obj.platform === 'feishu' || obj.platform === 'wechat' || obj.platform === 'qq') result.platform = obj.platform
    if (typeof obj.targetType === 'string') result.targetType = obj.targetType
    if (typeof obj.target === 'string') result.target = obj.target
    if (typeof obj.message === 'string') result.message = obj.message
    if (typeof obj.taskTitle === 'string') result.taskTitle = obj.taskTitle
    return result
  } catch {
    return null
  }
}

function localCommand(text: string): AssistantAction {
  if (/发|发送|发到|发消息|send/i.test(text)) return { action: 'send', message: text }
  if (/任务|待办|todo|task|安排|记得|跟进/i.test(text)) return { action: 'task', taskTitle: text }
  if (/总结|摘要|概括|汇总/i.test(text)) return { action: 'summarize' }
  return { action: 'unknown' }
}
