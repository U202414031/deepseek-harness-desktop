import { proxyFetch } from '../../http-proxy.ts'

/** A plugin discoverable through the desktop marketplace. */
export interface MarketplacePlugin {
  /** Stable unique id within the marketplace. */
  id: string
  /** Display name. */
  name: string
  /** Short description shown on the card. */
  description: string
  /** Original author or organization. */
  author?: string
  /** Source repository URL. */
  repository?: string
  /** Package specification passed to the installer (`npm:`, `github:`, `file:`). */
  installSpec: string
  /** Free-form topic tags. */
  tags: readonly string[]
  /** Star count, when known. */
  stars?: number
  /** Origin of the listing. */
  source: 'curated' | 'github'
}

/**
 * Curated fallback catalog shown before the live GitHub search resolves (or when
 * the search is rate-limited). These are illustrative entries; the live
 * `topic:deepseek-harness` query is the authoritative source of real plugins.
 */
export const CURATED_PLUGINS: readonly MarketplacePlugin[] = Object.freeze([
  {
    id: 'curated-dsh-theme-pack',
    name: 'DSH 主题包',
    description: '社区维护的深色/浅色主题扩展，为 DeepSeek Harness 增加更多界面皮肤。',
    author: 'dsh-community',
    installSpec: 'github:deepseek-ai/deepseek-harness',
    tags: ['theme', 'ui', 'example'],
    source: 'curated',
  },
  {
    id: 'curated-dsh-doc-tools',
    name: '文档工具集',
    description: '面向文档生成与导出的 DeepSeek Harness 插件示例。',
    author: 'dsh-community',
    installSpec: 'github:deepseek-ai/deepseek-harness',
    tags: ['tools', 'documents', 'example'],
    source: 'curated',
  },
  {
    id: 'curated-dsh-voice',
    name: '语音输入插件',
    description: '为 DeepSeek Harness 桌面端添加语音输入能力（示例条目）。',
    author: 'dsh-community',
    installSpec: 'github:deepseek-ai/deepseek-harness',
    tags: ['voice', 'input', 'example'],
    source: 'curated',
  },
])

/** Map a raw GitHub repository into a marketplace listing. */
function mapRepo(repo: GithubRepo): MarketplacePlugin {
  return {
    id: `gh-${repo.full_name}`,
    name: repo.name,
    description: repo.description ?? 'DeepSeek Harness 相关插件。',
    author: repo.owner?.login ?? 'unknown',
    repository: repo.html_url,
    installSpec: `github:${repo.full_name}`,
    tags: repo.topics ?? [],
    stars: repo.stargazers_count,
    source: 'github',
  }
}

/** A page of GitHub plugin listings plus a flag indicating more pages exist. */
export interface GithubPage {
  items: MarketplacePlugin[]
  hasMore: boolean
}

const GITHUB_PER_PAGE = 30

/** Hard timeout (ms) for each upstream attempt. Node's fetch has no default
 * timeout, so without this a blocked network would hang until TCP timeout and
 * freeze the marketplace UI (buttons stuck on "加载中"). */
const GITHUB_DIRECT_TIMEOUT = 8000
const GITHUB_MIRROR_TIMEOUT = 5000

/**
 * Direct GitHub API base. On networks where this is unreachable (mainland
 * China, corporate proxies) the request surfaces as a 502 from the upstream; we
 * then race against public mirror proxies that forward to api.github.com from a
 * reachable network.
 */
const GITHUB_DIRECT_BASE = 'https://api.github.com'

/**
 * Public GitHub mirror proxies. Each acts as a drop-in prefix that forwards
 * `https://api.github.com/<path>` to GitHub from a network that can reach it.
 * They are reverse proxies (not separate copies), so the data stays in sync with
 * GitHub (modulo a short cache). Raced in parallel with the direct link.
 */
const GITHUB_MIRRORS: readonly string[] = [
  'https://ghfast.top/https://api.github.com',
  'https://gh-proxy.com/https://api.github.com',
  'https://mirror.ghproxy.com/https://api.github.com',
]

/** localStorage key remembering which base last succeeded, to prefer it next time. */
const GITHUB_SOURCE_KEY = 'dsh-desktop-github-source'

function getPreferredBase(): string | null {
  try {
    return localStorage.getItem(GITHUB_SOURCE_KEY)
  } catch {
    return null
  }
}

function rememberWorkingBase(base: string): void {
  try {
    localStorage.setItem(GITHUB_SOURCE_KEY, base)
  } catch {
    /* storage unavailable — ignore */
  }
}

/** Bases to race: last-known-good first, then direct, then mirrors. */
function candidateBases(): string[] {
  const preferred = getPreferredBase()
  const ordered = preferred
    ? [preferred, GITHUB_DIRECT_BASE, ...GITHUB_MIRRORS]
    : [GITHUB_DIRECT_BASE, ...GITHUB_MIRRORS]
  const seen = new Set<string>()
  const result: string[] = []
  for (const base of ordered) {
    if (!seen.has(base)) {
      seen.add(base)
      result.push(base)
    }
  }
  return result
}

function buildSearchUrl(base: string, query: string, page: number): string {
  const q = encodeURIComponent(query)
  return `${base}/search/repositories?q=${q}&sort=stars&order=desc&per_page=${String(GITHUB_PER_PAGE)}&page=${String(page)}`
}

/** Wrap `parent` with a hard timeout so a hung upstream fetch cannot block forever. */
function withTimeout(parent: AbortSignal | null | undefined, ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, ms)
  const onAbort = (): void => { controller.abort() }
  if (parent !== null && parent !== undefined) parent.addEventListener('abort', onAbort, { once: true })
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer)
      if (parent !== null && parent !== undefined) parent.removeEventListener('abort', onAbort)
    },
  }
}

/**
 * One non-retrying attempt against a single base. Resolves with repo items on a
 * 2xx response; throws on any other outcome (rate-limit, bad query, network
 * failure). The caller races several of these in parallel.
 */
async function tryBase(base: string, query: string, page: number, signal: AbortSignal): Promise<GithubRepo[]> {
  const url = buildSearchUrl(base, query, page)
  const response = await proxyFetch(url, {
    signal,
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-desktop-marketplace',
    },
  })
  if (response.ok) {
    const payload = await response.json() as { items?: GithubRepo[] }
    return payload.items ?? []
  }
  if (response.status === 403 || response.status === 429 || response.status === 422 || response.status === 400 || response.status === 404) {
    let hint = ''
    if (response.status === 403 || response.status === 429) hint = '（GitHub 未登录接口每分钟限流约 10 次，请稍后重试或降低频率）'
    else if (response.status === 422) hint = '（查询过于复杂，请换一个更简短的关键词）'
    throw new Error(`GitHub 请求失败 (HTTP ${String(response.status)}) ${hint}`)
  }
  throw new Error(`GitHub 暂时不可用 (HTTP ${String(response.status)})`)
}

/**
 * Query the GitHub search API through the Host proxy, racing the direct
 * `api.github.com` endpoint against public mirror proxies in parallel. Whichever
 * base responds first wins; all others are cancelled. Every attempt is bounded by
 * a hard timeout (see `withTimeout`) so a blocked network can never freeze the
 * marketplace UI.
 *
 * Once a base succeeds it is remembered in localStorage so subsequent launches
 * prefer it (skipping a dead direct link). Rate-limit (403/429) and malformed-
 * query (422/400/404) errors are NOT raced against mirrors — the user must wait
 * or rephrase.
 */
async function githubSearch(query: string, page: number, signal?: AbortSignal): Promise<GithubRepo[]> {
  const bases = candidateBases()
  const master = new AbortController()

  const onCallerAbort = (): void => { master.abort() }
  if (signal !== null && signal !== undefined) signal.addEventListener('abort', onCallerAbort, { once: true })

  const tasks = bases.map((base) => (async (): Promise<{ ok: boolean; base?: string; items?: GithubRepo[]; error?: unknown }> => {
    const timeoutMs = base === GITHUB_DIRECT_BASE ? GITHUB_DIRECT_TIMEOUT : GITHUB_MIRROR_TIMEOUT
    const { signal: combined, clear } = withTimeout(master.signal, timeoutMs)
    try {
      const items = await tryBase(base, query, page, combined)
      clear()
      master.abort() // cancel sibling attempts — first success wins
      return { ok: true, base, items }
    } catch (cause) {
      clear()
      return { ok: false, error: cause }
    }
  })())

  try {
    const results = await Promise.all(tasks)
    const success = results.find((result) => result.ok)
    if (success?.ok && success.base !== undefined && success.items !== undefined) {
      rememberWorkingBase(success.base)
      return success.items
    }
    const lastError = results.map((result) => result.error).filter(Boolean).pop()
    throw lastError instanceof Error ? lastError : new Error('GitHub 请求失败')
  } finally {
    if (signal !== null && signal !== undefined) signal.removeEventListener('abort', onCallerAbort)
  }
}

/**
 * Load the dsh community catalog: repositories tagged with the DeepSeek Harness
 * topic. Routed through the Host proxy because the sandboxed renderer cannot
 * reach `api.github.com` directly. The primary topic is paginated via `page`;
 * two related topics are merged in only on the first page.
 */
export async function fetchGithubPlugins(page = 1, signal?: AbortSignal): Promise<GithubPage> {
  const seen = new Map<string, MarketplacePlugin>()
  let hasMore = false
  try {
    const items = await githubSearch('topic:deepseek-harness', page, signal)
    for (const repo of items) {
      const id = `gh-${repo.full_name}`
      if (!seen.has(id)) seen.set(id, mapRepo(repo))
    }
    hasMore = items.length >= GITHUB_PER_PAGE
  } catch (cause) {
    if (signal?.aborted) throw cause
  }
  if (page === 1) {
    const extra = ['topic:dsh-plugin', 'deepseek harness plugin']
    for (const query of extra) {
      try {
        const items = await githubSearch(query, 1, signal)
        for (const repo of items) {
          const id = `gh-${repo.full_name}`
          if (!seen.has(id)) seen.set(id, mapRepo(repo))
        }
      } catch (cause) {
        if (signal?.aborted) throw cause
      }
    }
  }
  return { items: [...seen.values()], hasMore }
}

/**
 * Free-text search across GitHub repositories. The query is widened with
 * `in:name,description,readme` so a bare keyword (Chinese or English) still
 * matches related plugin repos. Routed through the Host proxy because the
 * renderer cannot call api.github.com directly. Supports pagination via `page`.
 */
export async function searchGithubPlugins(query: string, page = 1, signal?: AbortSignal): Promise<GithubPage> {
  const trimmed = query.trim()
  if (trimmed.length === 0) return { items: [], hasMore: false }
  const items = await githubSearch(`${trimmed} in:name,description,readme`, page, signal)
  const mapped = items.map(mapRepo)
  return { items: mapped, hasMore: items.length >= GITHUB_PER_PAGE }
}

interface GithubRepo {
  full_name: string
  name: string
  description: string | null
  html_url: string
  stargazers_count: number
  topics?: string[]
  owner?: { login: string }
}

/**
 * 中英文「意图同义词表」：把用户用中文或英文说的需求，映射到一组检索关键词。
 * 例如输入「翻译」会同时匹配 translation / 多语言 / i18n 等；输入「文档」会匹配
 * doc / document / 文档导出。这是本地搜索「能懂我大致意思」的核心。
 */
const INTENT_SYNONYMS: Record<string, string[]> = {
  翻译: ['翻译', 'translate', 'translation', '多语言', '本地化', 'i18n', 'language', '语言'],
  文档: ['文档', 'doc', 'document', '文档生成', '文档导出', 'docs', '笔记', '整理'],
  语音: ['语音', 'voice', 'speech', 'tts', 'asr', '朗读', '听写', '口述'],
  图片: ['图片', '图像', 'image', 'picture', 'draw', '绘画', '插画', '文生图'],
  视频: ['视频', 'video', '影片', '文生视频', '短视频', '动态'],
  总结: ['总结', '摘要', 'summary', '归纳', '提炼', '要点'],
  写作: ['写作', '创作', '文案', 'write', 'writing', 'copywriting', '种草'],
  代码: ['代码', 'code', 'coding', 'programming', '编程', '开发', 'bug'],
  聊天: ['聊天', '对话', 'chat', 'assistant', '机器人', '智能体', '客服'],
  搜索: ['搜索', '检索', 'search', '联网', '抓取', '实时'],
  图表: ['图表', 'chart', 'diagram', '流程图', '思维导图', '可视化'],
  知识库: ['知识库', 'knowledge', 'rag', '检索增强', '私有', '文档问答'],
  自动化: ['自动化', 'automation', '工作流', 'workflow', '流程', '编排'],
  邮件: ['邮件', 'email', 'mail', '信件'],
  日历: ['日历', 'calendar', '日程'],
  天气: ['天气', 'weather'],
  音乐: ['音乐', 'music'],
  数据库: ['数据库', 'database', 'db', 'sql'],
  爬虫: ['爬虫', 'crawler', 'scrape', '采集'],
}

/** 把文本拆成检索词：英文按单词、中文保留整词并按相邻二元组切分（覆盖「翻译文案」部分匹配）。 */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const en = lower.match(/[a-z0-9]+/g) ?? []
  const cjk = lower.match(/[一-龥]+/g) ?? []
  const bigrams = cjk.flatMap((word) =>
    word.length > 1
      ? Array.from({ length: word.length - 1 }, (_, index) => word.slice(index, index + 2))
      : [word],
  )
  return [...en, ...cjk, ...bigrams]
}

/**
 * 纯本地的「中英文意图搜索」：不依赖任何网络。
 * 对 query 做分词 + 意图同义词扩展，再对插件名称/描述/标签打分排序。
 * 即使 GitHub 完全连不通，也能从内置社区目录里搜出相关插件。
 *
 * @returns 命中的插件（按相关度降序）；query 为空时返回空数组。
 */
export function localSearch(plugins: readonly MarketplacePlugin[], rawQuery: string): MarketplacePlugin[] {
  const query = rawQuery.trim()
  if (query.length === 0) return []
  const tokens = tokenize(query)

  // 把分词结果 + 命中的意图同义词一起作为检索集合
  const terms = new Set<string>(tokens)
  for (const token of tokens) {
    for (const synonyms of Object.values(INTENT_SYNONYMS)) {
      const hit = synonyms.some((syn) => syn.includes(token) || token.includes(syn))
      if (hit) for (const syn of synonyms) terms.add(syn)
    }
  }

  return plugins
    .map((plugin) => {
      const repo = plugin.repository ?? ''
      const spec = plugin.installSpec ?? ''
      const nameField = `${plugin.name} ${plugin.tags.join(' ')} ${repo} ${spec}`.toLowerCase()
      const descField = `${plugin.name} ${plugin.description} ${plugin.tags.join(' ')} ${repo} ${spec}`.toLowerCase()
      let score = 0
      for (const term of terms) {
        if (term.length === 0) continue
        if (nameField.includes(term)) score += 3
        else if (descField.includes(term)) score += 1
      }
      return { plugin, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.plugin)
}

