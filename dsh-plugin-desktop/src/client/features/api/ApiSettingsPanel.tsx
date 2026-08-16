import { useEffect, useMemo, useState } from 'react'
import type { ProviderSpec } from './provider-config.ts'
import { PROVIDERS } from './provider-config.ts'
import { useCurrentModel } from './current-model-store.ts'
import {
  clearApiKey, fetchBalance, getApiKey, setApiKey, type BalanceResult,
} from './api-service.ts'

/**
 * Desktop-owned API settings panel rendered in the left column. Auto-detects the
 * provider of the model currently in use, shows that provider's token usage and
 * balance (where queryable), and links to the matching recharge / key console.
 */
export function ApiSettingsPanel(): JSX.Element {
  const current = useCurrentModel()
  const [selectedId, setSelectedId] = useState<string>(() => current.specId ?? PROVIDERS[0]!.id)
  const [key, setKey] = useState<string>(() => getApiKey(current.specId ?? PROVIDERS[0]!.id))
  const [saved, setSaved] = useState<boolean>(false)
  const [balance, setBalance] = useState<BalanceResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-follow the detected provider, but keep manual overrides until detection changes.
  useEffect(() => {
    if (current.specId !== null && current.specId !== selectedId) setSelectedId(current.specId)
  }, [current.specId, selectedId])

  // Reload the stored key whenever the selected provider changes.
  useEffect(() => {
    setKey(getApiKey(selectedId))
    setSaved(false)
    setBalance(null)
    setError(null)
  }, [selectedId])

  const selected = useMemo<ProviderSpec>(
    () => PROVIDERS.find((p) => p.id === selectedId) ?? PROVIDERS[0]!,
    [selectedId],
  )

  const detectedLabel = current.specId !== null
    ? PROVIDERS.find((p) => p.id === current.specId)?.label ?? current.provider
    : null

  const onSave = () => {
    setApiKey(selectedId, key)
    setSaved(key.trim().length > 0)
    setBalance(null)
    setError(null)
  }

  const onClear = () => {
    clearApiKey(selectedId)
    setKey('')
    setSaved(false)
    setBalance(null)
    setError(null)
  }

  const onQuery = async () => {
    if (key.trim().length === 0) {
      setError('请先填写并保存 API Key。')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await fetchBalance(selected, key)
      setBalance(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : '查询余额时发生未知错误。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="dshDesktopApiSettings">
      <header className="dshDesktopFeatureHeader">
        <h2 className="dshDesktopFeatureTitle">API 设置</h2>
        <p className="dshDesktopFeatureSubtitle">自动识别当前对话使用的模型服务商，显示对应 Token 用量与余额，并可跳转充值界面。Key 仅保存在本机。</p>
      </header>

      <div className="dshDesktopProviderDetect">
        <span className="dshDesktopProviderDetectLabel">当前模型</span>
        {detectedLabel !== null ? (
          <b className="dshDesktopProviderDetectValue">{detectedLabel}{current.model ? ` · ${current.model}` : ''}</b>
        ) : (
          <b className="dshDesktopProviderDetectValue dshDesktopProviderDetectNone">未检测到（开始对话后将自动识别）</b>
        )}
      </div>

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

      {current.usage.count > 0 && (
        <div className="dshDesktopUsageTotal">
          <span>本会话 Token 用量（{detectedLabel ?? selected.label}）</span>
          <b>输入 {current.usage.promptTokens} · 输出 {current.usage.completionTokens} · 合计 {current.usage.totalTokens} tokens</b>
        </div>
      )}

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
              <div className="dshDesktopBalanceRow"><span>赠送余额</span><b>{info.grantedBalance}</b></div>
              <div className="dshDesktopBalanceRow"><span>充值余额</span><b>{info.toppedUpBalance}</b></div>
            </div>
          ))}
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
