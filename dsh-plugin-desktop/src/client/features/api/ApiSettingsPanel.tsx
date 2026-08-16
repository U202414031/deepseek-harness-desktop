import { useState } from 'react'
import {
  clearApiKey, fetchBalance, getApiKey, setApiKey, type BalanceResult,
} from './api-service.ts'

/**
 * Desktop-owned API settings panel rendered in the left column. Lets the user
 * provide their own DeepSeek API key and query their account balance / usage.
 */
export function ApiSettingsPanel(): JSX.Element {
  const [key, setKey] = useState<string>(() => getApiKey())
  const [saved, setSaved] = useState<boolean>(() => getApiKey().length > 0)
  const [balance, setBalance] = useState<BalanceResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSave = () => {
    setApiKey(key)
    setSaved(key.trim().length > 0)
    setBalance(null)
    setError(null)
  }

  const onClear = () => {
    clearApiKey()
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
      const result = await fetchBalance(key)
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
        <p className="dshDesktopFeatureSubtitle">填写你自己的 DeepSeek API Key，可查询账户余额与用量。Key 仅保存在本机。</p>
      </header>

      <label className="dshDesktopSkinField">
        <span>API Key</span>
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
      {saved && <p className="dshDesktopApiStatus">API Key 已保存。</p>}

      <button
        type="button"
        className="dshDesktopPrimaryButton dshDesktopApiQuery"
        onClick={onQuery}
        disabled={loading}
      >
        {loading ? '查询中…' : '查询余额'}
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
    </div>
  )
}
