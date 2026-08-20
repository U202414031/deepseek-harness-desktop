import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MarketplacePlugin } from './curated-registry.ts'
import { fetchGithubPlugins, localSearch, searchGithubPlugins } from './curated-registry.ts'
import { COMMUNITY_PLUGINS } from './community-registry.ts'

/** LocalStorage key holding ids of plugins the user has installed. */
const INSTALLED_KEY = 'dsh-desktop-installed-plugins'

/** How many plugins to reveal at once; "加载更多" reveals the next batch. */
const MARKETPLACE_PAGE = 10

interface InstallResult {
  ok: boolean
  error?: string
  log?: string
  exitCode?: number | null
}

/** Desktop-owned plugin marketplace rendered in the left column. */
export function MarketplacePanel(): JSX.Element {
  const [githubPlugins, setGithubPlugins] = useState<readonly MarketplacePlugin[]>([])
  const [loading, setLoading] = useState(false)
  // `error` 仅用于安装/操作失败；`hint` 用于 GitHub 不可达等柔和提示（不报错、不空白）。
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [installed, setInstalled] = useState<readonly string[]>(readInstalled())
  const [busy, setBusy] = useState<string | null>(null)
  const [lastLog, setLastLog] = useState<string | null>(null)

  // Search box + listing mode. Non-empty query => we are showing search results.
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  // 本地分页：一次只展示 `visibleCount` 个，点「加载更多」再揭示下一批（不依赖网络）。
  const [visibleCount, setVisibleCount] = useState(MARKETPLACE_PAGE)
  const listControllerRef = useRef<AbortController | null>(null)
  /**
   * 开始一次新的「列表/搜索」网络请求：先取消上一个仍未完成的同类请求。
   * 否则旧请求（例如首屏默认仓库加载）完成后会覆盖新结果——表现为
   * "搜索结果先显示、一两秒后被默认仓库列表顶掉"（时有时无，取决于
   * 首屏默认加载是否在搜索发起前已经完成）。
   */
  const beginListRequest = useCallback((): AbortController => {
    listControllerRef.current?.abort()
    const controller = new AbortController()
    listControllerRef.current = controller
    return controller
  }, [])
  const pageRef = useRef<number>(1)

  // 内置社区目录永远作为底仓：默认展示 = 社区目录 + 联网拉到的 GitHub 仓库。
  // 即便 GitHub 完全连不通，这里也至少有一份真实可用的 dsh 社区插件清单。
  const mergedPlugins = useMemo(() => mergePlugins(COMMUNITY_PLUGINS, githubPlugins), [githubPlugins])
  // 默认按 star 数从高到低排序，热门插件优先展示。
  const allPlugins = useMemo(
    () => [...mergedPlugins].sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0)),
    [mergedPlugins],
  )

  /**
   * 加载 dsh 社区仓库（带分页）。默认先用内置目录兜底，再在后台静默尝试 GitHub：
   * 成功则合并真实仓库；失败（502/超时/限流）则保留内置目录并给一句柔和提示，绝不空白。
   */
  const loadDefault = useCallback(async (reset: boolean, externalSignal?: AbortSignal) => {
    const own = externalSignal === undefined ? beginListRequest() : null
    const signal = externalSignal ?? own!.signal
    const next = reset ? 1 : pageRef.current + 1
    setLoading(true)
    if (reset) { setHint(null); setError(null); setVisibleCount(MARKETPLACE_PAGE) }
    try {
      const { items } = await fetchGithubPlugins(next, signal)
      setGithubPlugins((prev) => (reset ? items : appendPlugins(prev, items)))
      pageRef.current = next
    } catch (cause) {
      if (signal?.aborted) return
      const reason = cause instanceof Error ? cause.message : '未知错误'
      setHint(`GitHub 实时列表暂不可用（${reason}）。已为你展示内置的 dsh 社区精选插件；连通后点「刷新列表」可获取更多。`)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [beginListRequest])

  /**
   * 执行搜索：本地意图搜索（localSearch）即时返回结果，不依赖网络；同时后台尝试
   * GitHub 实时搜索并追加匹配项。GitHub 连不通时本地结果照常可用。
   */
  const runSearch = useCallback(async (raw: string, reset: boolean, externalSignal?: AbortSignal) => {
    const q = raw.trim()
    if (q.length === 0) {
      void loadDefault(true, externalSignal)
      return
    }
    const own = externalSignal === undefined ? beginListRequest() : null
    const signal = externalSignal ?? own!.signal
    const next = reset ? 1 : pageRef.current + 1
    setSearching(true)
    setHint(null)
    if (reset) setVisibleCount(MARKETPLACE_PAGE)
    try {
      const { items } = await searchGithubPlugins(q, next, signal)
      setGithubPlugins((prev) => (reset ? items : appendPlugins(prev, items)))
      pageRef.current = next
    } catch (cause) {
      if (signal?.aborted) return
      const reason = cause instanceof Error ? cause.message : '未知错误'
      setHint(`GitHub 实时搜索暂不可用（${reason}）。已用本地意图搜索为你匹配内置社区插件（支持中英文）。`)
    } finally {
      if (!signal?.aborted) setSearching(false)
    }
  }, [loadDefault, beginListRequest])

  useEffect(() => {
    void loadDefault(true)
    return () => { listControllerRef.current?.abort() }
  }, [loadDefault])

  // Re-run the default catalog whenever the query box is cleared back to empty.
  const onQueryChange = useCallback((value: string) => {
    setQuery(value)
    if (value.trim().length === 0) {
      setSearching(false)
      setHint(null)
      void loadDefault(true)
    }
  }, [loadDefault])

  const onSubmitSearch = useCallback((event: React.FormEvent) => {
    event.preventDefault()
    void runSearch(query, true)
  }, [query, runSearch])

  // 「加载更多」只揭示本地已加载列表的下一批，完全不依赖网络（GitHub 不可达也能翻页）。
  const onLoadMore = useCallback(() => {
    setVisibleCount((count) => count + MARKETPLACE_PAGE)
  }, [])

  useEffect(() => () => { listControllerRef.current?.abort() }, [])

  // 展示列表：搜索时走本地中英文意图匹配，并合并任何已拉到的 GitHub 实时结果（联网时）。
  // 空查询则展示全部（社区目录 + GitHub 合并后、按 star 排序）。
  const trimmed = query.trim()
  const queryHits = useMemo(
    () => (trimmed.length === 0
      ? allPlugins
      : mergeSearchResults(localSearch(allPlugins, trimmed), githubPlugins)),
    [allPlugins, trimmed, githubPlugins],
  )
  const plugins = queryHits
  const isSearchEmpty = trimmed.length > 0 && !searching && queryHits.length === 0
  // 查询词变化时重置分页，从第一页开始展示。
  useEffect(() => { setVisibleCount(MARKETPLACE_PAGE) }, [trimmed])

  const runOperation = useCallback(async (plugin: MarketplacePlugin, mode: 'install' | 'uninstall' | 'update') => {
    setBusy(plugin.id)
    setLastLog(null)
    try {
      const response = await fetch(`/desktop/marketplace/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spec: plugin.installSpec }),
      })
      const data = await response.json() as InstallResult
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? `操作失败 (HTTP ${String(response.status)})`)
      }
      setLastLog(data.log ?? '')
      setInstalled(prev => mode === 'uninstall'
        ? prev.filter(id => id !== plugin.id)
        : [...new Set([...prev, plugin.id])])
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      setLastLog(message)
    } finally {
      setBusy(null)
    }
  }, [])

  const isInstalled = useCallback((id: string) => installed.includes(id), [installed])

  return (
    <div className="dshDesktopMarketplace">
      <header className="dshDesktopFeatureHeader">
        <h2 className="dshDesktopFeatureTitle">插件市场</h2>
        <p className="dshDesktopFeatureSubtitle">发现并安装适用于 DeepSeek Harness 桌面端的 dsh 插件。</p>
        <form className="dshDesktopSearchRow" onSubmit={onSubmitSearch}>
          <input
            type="search"
            className="dshDesktopSearchInput"
            placeholder="搜索插件（支持中英文，如：翻译 / cc-connect / 文档工具）"
            value={query}
            onChange={(event) => { onQueryChange(event.target.value) }}
            aria-label="搜索插件"
          />
          <button
            type="submit"
            className="dshDesktopSecondaryButton"
          >
            {searching ? '搜索中…' : '搜索'}
          </button>
          {query.trim().length > 0 && (
            <button
              type="button"
              className="dshDesktopLinkButton"
              onClick={() => { setQuery(''); setSearching(false); void loadDefault(true) }}
            >
              清除
            </button>
          )}
        </form>
        <button
          type="button"
          className="dshDesktopSecondaryButton dshDesktopRefreshButton"
          onClick={() => { void loadDefault(true) }}
          disabled={loading}
        >
          {loading ? '加载中…' : '刷新列表'}
        </button>
      </header>

      {hint !== null && <p className="dshDesktopMarketplaceHintNote">{hint}</p>}
      {searching && (
        <p className="dshDesktopMarketplaceHintNote">正在 GitHub 上搜索「{trimmed}」…</p>
      )}
      {isSearchEmpty && (
        <p className="dshDesktopMarketplaceHintNote">未找到与「{trimmed}」相关的 GitHub 仓库，可换一个更具体的关键词试试。</p>
      )}
      {error !== null && <p className="dshDesktopMarketplaceNote">{error}</p>}
      {lastLog !== null && (
        <pre className="dshDesktopMarketplaceLog" role="status">{lastLog}</pre>
      )}

      <ul className="dshDesktopPluginList">
        {plugins.slice(0, visibleCount).map(plugin => {
          const installedNow = isInstalled(plugin.id)
          const active = busy === plugin.id
          return (
            <li key={plugin.id} className="dshDesktopPluginCard">
              <div className="dshDesktopPluginHead">
                <span className="dshDesktopPluginName">{plugin.name}</span>
                {plugin.stars !== undefined && (
                  <span className="dshDesktopPluginStars">★ {formatStars(plugin.stars)}</span>
                )}
              </div>
              <p className="dshDesktopPluginDesc">{plugin.description}</p>
              {plugin.tags.length > 0 && (
                <div className="dshDesktopPluginTags">
                  {plugin.tags.slice(0, 5).map(tag => (
                    <span key={tag} className="dshDesktopPluginTag">{tag}</span>
                  ))}
                </div>
              )}
              <div className="dshDesktopPluginActions">
                {installedNow
                  ? (
                    <>
                      <button
                        type="button"
                        className="dshDesktopSecondaryButton"
                        disabled={active}
                        onClick={() => { void runOperation(plugin, 'update') }}
                      >
                        {active ? '处理中…' : '更新'}
                      </button>
                      <button
                        type="button"
                        className="dshDesktopDangerButton"
                        disabled={active}
                        onClick={() => { void runOperation(plugin, 'uninstall') }}
                      >
                        {active ? '处理中…' : '卸载'}
                      </button>
                    </>
                  )
                  : (
                    <button
                      type="button"
                      className="dshDesktopPrimaryButton"
                      disabled={active}
                      onClick={() => { void runOperation(plugin, 'install') }}
                    >
                      {active ? '安装中…' : '安装'}
                    </button>
                  )}
                {plugin.repository !== undefined && (
                  <a
                    className="dshDesktopLinkButton"
                    href={plugin.repository}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    仓库
                  </a>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {plugins.length > visibleCount && (
        <button
          type="button"
          className="dshDesktopSecondaryButton dshDesktopLoadMore"
          onClick={() => { onLoadMore() }}
        >
          {`加载更多（已显示 ${Math.min(visibleCount, plugins.length)} / ${plugins.length}）`}
        </button>
      )}
    </div>
  )
}

function mergePlugins(
  base: readonly MarketplacePlugin[],
  extra: readonly MarketplacePlugin[],
): MarketplacePlugin[] {
  const byId = new Map<string, MarketplacePlugin>()
  for (const plugin of base) byId.set(plugin.id, plugin)
  for (const plugin of extra) byId.set(plugin.id, plugin)
  return [...byId.values()]
}

/** Append `extra` to `base` without duplicating entries by id. */
function appendPlugins(
  base: readonly MarketplacePlugin[],
  extra: readonly MarketplacePlugin[],
): MarketplacePlugin[] {
  const byId = new Map<string, MarketplacePlugin>()
  for (const plugin of base) byId.set(plugin.id, plugin)
  for (const plugin of extra) if (!byId.has(plugin.id)) byId.set(plugin.id, plugin)
  return [...byId.values()]
}

/**
 * 把本地意图搜索命中的结果，与已拉取到的 GitHub 实时结果合并去重。
 * 本地结果优先（已按相关度排好），GitHub 实时结果（联网时）作为补充追加在后。
 */
function mergeSearchResults(
  local: readonly MarketplacePlugin[],
  live: readonly MarketplacePlugin[],
): MarketplacePlugin[] {
  const byId = new Map<string, MarketplacePlugin>()
  for (const plugin of local) byId.set(plugin.id, plugin)
  for (const plugin of live) if (!byId.has(plugin.id)) byId.set(plugin.id, plugin)
  return [...byId.values()]
}

/** 把 star 数格式化为紧凑形式：144743 → 144.7k，15005 → 15.0k，592 → 592。 */
function formatStars(value: number): string {
  if (value >= 1000) {
    const k = value / 1000
    return `${k >= 10 ? k.toFixed(0) : k.toFixed(1)}k`
  }
  return String(value)
}

function readInstalled(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(INSTALLED_KEY)
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.filter((value): value is string => typeof value === 'string')
    }
  } catch {
    // ignore storage failures
  }
  return []
}
