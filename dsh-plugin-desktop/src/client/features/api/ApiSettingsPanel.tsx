import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProviderSpec } from './provider-config.ts'
import { PROVIDERS, labelForModel, labelForProvider } from './provider-config.ts'
import { useCurrentModel } from './current-model-store.ts'
import { formatCost, parseBalanceAmount, type CostInfo, type UsageEntry, type UsageSummary } from '../usage/usage.ts'
import {
  clearApiKey, fetchBalance, getApiKey, setApiKey, type BalanceResult,
} from './api-service.ts'

/**
 * Desktop-owned API settings panel rendered in the left column. Auto-detects the
 * provider + model currently in use, shows per-reply token usage and estimated
 * cost in real time (each finalized reply appends a row), totals the session,
 * and shows the account balance (where queryable) with the estimated remaining
 * amount after this session's consumption.
 */
export function ApiSettingsPanel(): JSX.Element {
  const current = useCurrentModel()
  const [selectedId, setSelectedId] = useState<string>(() => current.specId ?? PROVIDERS[0]!.id)
  const [key, setKey] = useState<string>(() => getApiKey(current.specId ?? PROVIDERS[0]!.id))
  const [saved, setSaved] = useState<boolean>(false)
  const [balance, setBalance] = useState<BalanceResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const queryInFlight = useRef(false)

  const selected = useMemo<ProviderSpec>(
    () => PROVIDERS.find((p) => p.id === selectedId) ?? PROVIDERS[0]!,
    [selectedId],
  )

  const queryBalance = async (spec: ProviderSpec, apiKey: string): Promise<void> => {
    if (queryInFlight.current) return
    queryInFlight.current = true
    setLoading(true)
    setError(null)
    try {
      const result = await fetchBalance(spec, apiKey)
      setBalance(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : '查询余额时发生未知错误。')
    } finally {
      setLoading(false)
      queryInFlight.current = false
    }
  }

  // Auto-follow the detected provider, but keep manual overrides until detection changes.
  useEffect(() => {
    if (current.specId !== null && current.specId !== selectedId) setSelectedId(current.specId)
  }, [current.specId, selectedId])

  // Reload the stored key whenever the selected provider changes, and quietly
  // re-query the balance when a key is already saved for that provider.
  useEffect(() => {
    const stored = getApiKey(selectedId)
    setKey(stored)
    setSaved(false)
    setBalance(null)
    setError(null)
    const spec = PROVIDERS.find((p) => p.id === selectedId) ?? PROVIDERS[0]!
    if (stored.trim().length > 0 && spec.balanceSupported) {
      void queryBalance(spec, stored.trim())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const providerLabel = current.specId !== null
    ? (PROVIDERS.find((p) => p.id === current.specId)?.label ?? current.provider)
    : (labelForProvider(current.provider) ?? current.provider)
  const modelLabel = labelForModel(current.model)
  const detectedSomething = current.provider !== undefined || current.model !== undefined

  const onSave = () => {
    const trimmed = key.trim()
    setApiKey(selectedId, trimmed)
    setSaved(trimmed.length > 0)
    setBalance(null)
    setError(null)
    if (trimmed.length > 0 && selected.balanceSupported) void queryBalance(selected, trimmed)
  }

  const onClear = () => {
    clearApiKey(selectedId)
    setKey('')
    setSaved(false)
    setBalance(null)
    setError(null)
  }

  const onQuery = () => {
    if (key.trim().length === 0) {
      setError('请先填写并保存 API Key。')
      return
    }
    void queryBalance(selected, key.trim())
  }

  const remaining = balance !== null && selected.id === current.specId
    ? estimateRemaining(balance, current.summary.cost)
    : null

  /**
   * Scroll the conversation to the reply whose usage row was clicked. The
   * exact row may be absent when the reply is a tool-call-only step (the chat
   * flow hides steps without visible text), so fall back to the injected
   * usage footer (`data-seq`) and then to that turn's tail row.
   */
  const jumpToReply = (seq: number, turn: number): void => {
    const scrollTo = (element: Element): void => {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (element instanceof HTMLElement) {
        element.classList.add('dshDesktopChatFlash')
        window.setTimeout(() => { element.classList.remove('dshDesktopChatFlash') }, 1800)
      }
    }
    const key = current.chatKeysBySeq[seq]
    if (key !== undefined) {
      const row = document.querySelector(`[data-chat-anchor-key="${CSS.escape(key)}"]`)
      if (row !== null) {
        scrollTo(row)
        return
      }
    }
    const footerRow = document.querySelector(`[data-seq="${CSS.escape(String(seq))}"]`)
    if (footerRow !== null) {
      scrollTo(footerRow)
      return
    }
    const turnRow = document.querySelector(`[data-turn-tail="${CSS.escape(String(turn))}"]`)
    if (turnRow !== null) {
      scrollTo(turnRow)
    }
  }

  return (
    <div className="dshDesktopApiSettings">
      <header className="dshDesktopFeatureHeader">
        <h2 className="dshDesktopFeatureTitle">API 设置</h2>
        <p className="dshDesktopFeatureSubtitle">自动识别当前对话使用的模型，实时显示每段回复的 Token 用量与消费，并可查询余额。Key 仅保存在本机。</p>
      </header>

      <div className="dshDesktopProviderDetect">
        <span className="dshDesktopProviderDetectLabel">
          当前模型{current.running ? ' · 正在生成回复' : ''}
        </span>
        {detectedSomething ? (
          <>
            <b className="dshDesktopProviderDetectValue">
              {providerLabel ?? '未知服务商'}{modelLabel !== undefined ? ` · ${modelLabel}` : ''}
              {current.running && <span className="dshDesktopUsageLive">● 生成中</span>}
            </b>
            <span className="dshDesktopProviderDetectRaw">
              provider: {current.provider ?? '—'} · model: {current.model ?? '—'}
            </span>
          </>
        ) : (
          <b className="dshDesktopProviderDetectValue dshDesktopProviderDetectNone">未检测到（开始对话后将自动识别）</b>
        )}
      </div>

      <UsagePanel entries={current.entries} summary={current.summary} running={current.running} onJump={jumpToReply} />

      <label className="dshDesktopSkinField">
        <span>管理服务商</span>
        <select
          className="dshDesktopSearchInput"
          value={selectedId}
          onChange={(event) => { setSelectedId(event.target.value) }}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>

      <label className="dshDesktopSkinField">
        <span>API Key（{selected.label}）</span>
        <input
          type="password"
          className="dshDesktopSearchInput"
          value={key}
          placeholder="sk-..."
          onChange={(event) => { setKey(event.target.value); setSaved(false) }}
        />
      </label>

      <div className="dshDesktopApiActions">
        <button type="button" className="dshDesktopPrimaryButton" onClick={onSave}>保存</button>
        <button type="button" className="dshDesktopSecondaryButton" onClick={onClear}>清除</button>
      </div>
      {saved && <p className="dshDesktopApiStatus">已保存 {selected.label} 的 API Key。</p>}

      <button
        type="button"
        className="dshDesktopPrimaryButton dshDesktopApiQuery"
        onClick={onQuery}
        disabled={loading}
      >
        {loading ? '查询中…' : `查询${selected.label}余额`}
      </button>

      {error !== null && <p className="dshDesktopMarketplaceNote">{error}</p>}

      {balance !== null && balance.infos.length > 0 && (
        <div className="dshDesktopBalanceList">
          {balance.infos.map((info, index) => (
            <div key={index} className="dshDesktopBalanceCard">
              <div className="dshDesktopBalanceRow"><span>货币</span><b>{info.currency || '—'}</b></div>
              <div className="dshDesktopBalanceRow"><span>总余额</span><b>{info.totalBalance}</b></div>
              <div className="dshDesktopBalanceRow"><span>赠送余额</span><b>{info.grantedBalance || '—'}</b></div>
              <div className="dshDesktopBalanceRow"><span>充值余额</span><b>{info.toppedUpBalance || '—'}</b></div>
            </div>
          ))}
          {current.summary.cost !== null && selected.id === current.specId && (
            <div className="dshDesktopBalanceCard dshDesktopBalanceRemain">
              <div className="dshDesktopBalanceRow"><span>本会话消费（估算）</span><b>{formatCost(current.summary.cost)}</b></div>
              {remaining !== null && (
                <div className="dshDesktopBalanceRow"><span>预计剩余余额</span><b>{remaining}</b></div>
              )}
            </div>
          )}
          {current.summary.cost !== null && selected.id !== current.specId && (
            <p className="dshDesktopMarketplaceNote">当前查看的是 {selected.label} 的余额，与本会话用量（{providerLabel ?? '未知服务商'}）不一致，未计算消费。</p>
          )}
        </div>
      )}
      {balance !== null && balance.infos.length === 0 && (
        <p className="dshDesktopMarketplaceNote">未查询到余额信息（账户可能不可用）。</p>
      )}

      <div className="dshDesktopApiLinks">
        <a className="dshDesktopPrimaryButton dshDesktopApiLink" href={selected.rechargeUrl} target="_blank" rel="noreferrer">前往{selected.label}充值</a>
        <a className="dshDesktopSecondaryButton dshDesktopApiLink" href={selected.apiKeyUrl} target="_blank" rel="noreferrer">管理{selected.label} API Key</a>
      </div>
    </div>
  )
}

/** Per-reply usage list + session totals, updating as replies finalize. */
function UsagePanel({
  entries, summary, running, onJump,
}: {
  entries: readonly UsageEntry[]
  summary: UsageSummary
  running: boolean
  onJump: (seq: number, turn: number) => void
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? entries : entries.slice(-20)
  return (
    <section className="dshDesktopUsageSection">
      <h3 className="dshDesktopUsageHeading">每段对话用量（点击跳转到对应回复）</h3>
      {entries.length === 0 ? (
        <p className="dshDesktopUsageEmpty">
          {running ? '正在生成中，回复完成后将自动显示用量。' : '暂无用量数据——每完成一段回复后会实时更新。'}
        </p>
      ) : (
        <>
          <ul className="dshDesktopUsageList">
            {visible.map((entry) => {
              const u = entry.usage
              const extras = [
                u.cacheHitTokens !== undefined ? `缓存命中 ${u.cacheHitTokens}` : null,
                u.cacheWriteTokens !== undefined ? `缓存写入 ${u.cacheWriteTokens}` : null,
                u.reasoningTokens !== undefined ? `推理 ${u.reasoningTokens}` : null,
              ].filter((part): part is string => part !== null)
              return (
                <li key={entry.seq} className="dshDesktopUsageRow">
                  <button
                    type="button"
                    className="dshDesktopUsageJump"
                    title={`跳转到回复 #${entry.turn}${entry.step > 0 ? `.${entry.step}` : ''}`}
                    onClick={() => { onJump(entry.seq, entry.turn) }}
                  >
                    <span className="dshDesktopUsageTurnRow">
                      <span className="dshDesktopUsageTurn">#{entry.turn}{entry.step > 0 ? `.${entry.step}` : ''}</span>
                      {entry.model !== undefined && <span className="dshDesktopUsageModel">{labelForModel(entry.model)}</span>}
                      <span className="dshDesktopUsageTime">{formatTime(entry.time)}</span>
                    </span>
                    <span className="dshDesktopUsageNumbers">输入 {u.promptTokens} · 输出 {u.completionTokens} · 合计 {u.totalTokens}</span>
                    {extras.length > 0 && <span className="dshDesktopUsageCache">{extras.join(' · ')}</span>}
                    {entry.cost !== null && (
                      <span className="dshDesktopUsagePrice">
                        费用 {formatCost(entry.cost)}{entry.cost.estimated ? '（估算）' : ''}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
          {entries.length > 20 && (
            <button
              type="button"
              className="dshDesktopUsageExpand"
              onClick={() => { setExpanded((value) => !value) }}
            >
              {expanded ? '收起（仅显示最近 20 段）' : `展开全部（共 ${entries.length} 段）`}
            </button>
          )}
        </>
      )}

      <div className="dshDesktopUsageTotal">
        <span>本会话总用量（{summary.count} 段回复）</span>
        <b>输入 {summary.promptTokens} · 输出 {summary.completionTokens} · 合计 {summary.totalTokens} tokens</b>
        {summary.cost !== null && (
          <span>
            累计消费 {formatCost(summary.cost)}
            {summary.cost.estimated === true ? '（按官方单价估算，实际以账单为准）' : ''}
          </span>
        )}
      </div>
    </section>
  )
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(undefined, { hour12: false })
}

/** Balance minus this session's estimated consumption, when currencies match. */
function estimateRemaining(balance: BalanceResult, cost: CostInfo | null): string | null {
  if (cost === null) return null
  for (const info of balance.infos) {
    const currency = info.currency || cost.currency
    if (currency !== cost.currency) continue
    const total = parseBalanceAmount(info.totalBalance)
    if (total === null) continue
    return formatCost({ amount: Math.max(0, total - cost.amount), currency: cost.currency, estimated: true })
  }
  return null
}
