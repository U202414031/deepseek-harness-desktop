/**
 * Local storage + network helpers for the user-owned DeepSeek API key.
 *
 * The key is kept only in the renderer's localStorage (this is a local desktop
 * client, not a shared service). Balance is queried directly against the
 * DeepSeek REST API using the user's own key.
 */

const API_KEY_STORAGE = 'dsh-desktop-api-key'
const DEEPSEEK_BASE = 'https://api.deepseek.com'

/** @returns the saved API key, or an empty string when none is stored. */
export function getApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

/** Persist the API key (empty input clears it). */
export function setApiKey(key: string): void {
  try {
    const trimmed = key.trim()
    if (trimmed.length === 0) localStorage.removeItem(API_KEY_STORAGE)
    else localStorage.setItem(API_KEY_STORAGE, trimmed)
  } catch {
    /* storage unavailable — ignore */
  }
}

/** Remove any stored API key. */
export function clearApiKey(): void {
  try {
    localStorage.removeItem(API_KEY_STORAGE)
  } catch {
    /* ignore */
  }
}

/** One currency-denominated balance line returned by the DeepSeek API. */
export interface BalanceInfo {
  currency: string
  totalBalance: string
  grantedBalance: string
  toppedUpBalance: string
}

/** Normalized balance response. */
export interface BalanceResult {
  available: boolean
  infos: BalanceInfo[]
}

/**
 * Query the DeepSeek account balance for the given key.
 * @throws when the request fails or returns a non-OK status.
 */
export async function fetchBalance(apiKey: string): Promise<BalanceResult> {
  const response = await fetch(`${DEEPSEEK_BASE}/user/balance`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
  })
  if (!response.ok) {
    throw new Error(`查询余额失败：HTTP ${response.status}${response.status === 401 ? '（密钥无效或无权限）' : ''}`)
  }
  const data = await response.json() as {
    is_available?: boolean
    balance_infos?: Array<{
      currency?: string
      total_balance?: string | number
      granted_balance?: string | number
      topped_up_balance?: string | number
    }>
  }
  const infos: BalanceInfo[] = (data.balance_infos ?? []).map((b) => ({
    currency: b.currency ?? '',
    totalBalance: String(b.total_balance ?? ''),
    grantedBalance: String(b.granted_balance ?? ''),
    toppedUpBalance: String(b.topped_up_balance ?? ''),
  }))
  return { available: data.is_available ?? infos.length > 0, infos }
}
