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

/** Query GitHub for repositories tagged with the DeepSeek Harness topic. */
export async function fetchGithubPlugins(signal?: AbortSignal): Promise<MarketplacePlugin[]> {
  const queries = [
    'topic:deepseek-harness',
    'topic:dsh-plugin',
    'deepseek harness plugin',
  ]
  const seen = new Map<string, MarketplacePlugin>()
  for (const query of queries) {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=30`
    try {
      const response = await fetch(url, {
        signal: signal ?? null,
        headers: { accept: 'application/vnd.github+json' },
      })
      if (!response.ok) continue
      const payload = await response.json() as { items?: GithubRepo[] }
      for (const repo of payload.items ?? []) {
        const id = `gh-${repo.full_name}`
        if (seen.has(id)) continue
        seen.set(id, {
          id,
          name: repo.name,
          description: repo.description ?? 'DeepSeek Harness 相关插件。',
          author: repo.owner?.login ?? 'unknown',
          repository: repo.html_url,
          installSpec: `github:${repo.full_name}`,
          tags: repo.topics ?? [],
          stars: repo.stargazers_count,
          source: 'github',
        })
      }
    } catch (cause) {
      if (signal?.aborted) throw cause
      // a single failing query should not abort the whole catalog
    }
  }
  return [...seen.values()]
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
