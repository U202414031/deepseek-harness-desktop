import { getApiKey } from '../api/api-service.ts'

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
    const response = await fetch(DEEPSEEK_CHAT, {
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
