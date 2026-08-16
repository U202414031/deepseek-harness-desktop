import { useCallback, useEffect, useRef, useState } from 'react'
import type { MarketplacePlugin } from './curated-registry.ts'
import { CURATED_PLUGINS, fetchGithubPlugins, searchGithubPlugins } from './curated-registry.ts'

/** LocalStorage key holding ids of plugins the user has installed. */
const INSTALLED_KEY = 'dsh-desktop-installed-plugins'

interface InstallResult {
  ok: boolean
  error?: string
  log?: string
  exitCode?: number | null
}

/** Desktop-owned plugin marketplace rendered in the left column. */
export function MarketplacePanel(): JSX.Element {
  const [plugins, setPlugins] = useState<readonly MarketplacePlugin[]>(CURATED_PLUGINS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [installed, setInstalled] = useState<readonly string[]>(readInstalled())
  const [busy, setBusy] = useState<string | null>(null)
  const [lastLog, setLastLog] = useState<string | null>(null)

  // Search state: when `query` is non-empty we are showing GitHub search results.
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const searchController = useRef<AbortController | null>(null)

  const loadDefault = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const github = await fetchGithubPlugins(signal)
      const merged = mergePlugins(CURATED_PLUGINS, github)
      setPlugins(merged)
    } catch (cause) {
      if (signal?.aborted) return
      setError(cause instanceof Error ? cause.message : '无法加载 GitHub 插件列表，已回退到内置列表。')
      setPlugins(CURATED_PLUGINS)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  const runSearch = useCallback(async (raw: string, signal?: AbortSignal) => {
    const q = raw.trim()
    if (q.length === 0) {
      await loadDefault(signal)
      return
    }
    setSearching(true)
    setError(null)
    try {
      const results = await searchGithubPlugins(q, signal)
      setPlugins(results)
      if (results.length === 0) setError(`GitHub 上没有找到与「${q}」相关的仓库。`)
    } catch (cause) {
      if (signal?.aborted) return
      setError(cause instanceof Error ? cause.message : '搜索失败，请稍后再试。')
      setPlugins([])
    } finally {
      if (!signal?.aborted) setSearching(false)
    }
  }, [loadDefault])

  useEffect(() => {
    const controller = new AbortController()
    void loadDefault(controller.signal)
    return () => { controller.abort() }
  }, [loadDefault])

  // Re-run the active search whenever the query box is cleared back to empty.
  const onQueryChange = useCallback((value: string) => {
    setQuery(value)
    if (value.trim().length === 0) {
      searchController.current?.abort()
      setSearching(false)
      void loadDefault()
    }
  }, [loadDefault])

  const onSubmitSearch = useCallback((event: React.FormEvent) => {
    event.preventDefault()
    searchController.current?.abort()
    const controller = new AbortController()
    searchController.current = controller
    void runSearch(query, controller.signal)
  }, [query, runSearch])

  useEffect(() => () => { searchController.current?.abort() }, [])

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
      setLastLog(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }, [])

  const isInstalled = useCallback((id: string) => installed.includes(id), [installed])
  const isSearching = loading || searching

  return (
    <div className="dshDesktopMarketplace">
      <header className="dshDesktopFeatureHeader">
        <h2 className="dshDesktopFeatureTitle">插件市场</h2>
        <p className="dshDesktopFeatureSubtitle">发现并安装适用于 DeepSeek Harness 桌面端的 dsh 插件。</p>
        <form className="dshDesktopSearchRow" onSubmit={onSubmitSearch}>
          <input
            type="search"
            className="dshDesktopSearchInput"
            placeholder="搜索 GitHub 上的插件（关键词 / 仓库名）"
            value={query}
            onChange={(event) => { onQueryChange(event.target.value) }}
            aria-label="搜索插件"
          />
          <button
            type="submit"
            className="dshDesktopSecondaryButton"
            disabled={isSearching}
          >
            {searching ? '搜索中…' : '搜索'}
          </button>
          {query.trim().length > 0 && (
            <button
              type="button"
              className="dshDesktopLinkButton"
              onClick={() => { setQuery(''); searchController.current?.abort(); setSearching(false); void loadDefault() }}
              disabled={isSearching}
            >
              清除
            </button>
          )}
        </form>
        <button
          type="button"
          className="dshDesktopSecondaryButton dshDesktopRefreshButton"
          onClick={() => { void loadDefault() }}
          disabled={isSearching}
        >
          {loading ? '加载中…' : '刷新列表'}
        </button>
      </header>

      {error !== null && <p className="dshDesktopMarketplaceNote">{error}</p>}
      {lastLog !== null && (
        <pre className="dshDesktopMarketplaceLog" role="status">{lastLog}</pre>
      )}

      <ul className="dshDesktopPluginList">
        {plugins.map(plugin => {
          const installedNow = isInstalled(plugin.id)
          const active = busy === plugin.id
          return (
            <li key={plugin.id} className="dshDesktopPluginCard">
              <div className="dshDesktopPluginHead">
                <span className="dshDesktopPluginName">{plugin.name}</span>
                {plugin.stars !== undefined && (
                  <span className="dshDesktopPluginStars">★ {String(plugin.stars)}</span>
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
