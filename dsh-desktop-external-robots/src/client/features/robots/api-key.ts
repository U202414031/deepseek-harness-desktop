/**
 * Self-contained copy of the API-key reader (the upstream `api` feature lives in
 * its own bundle now). Keys are stored in the renderer's localStorage under the
 * same `dsh-desktop-api-key` prefix so both bundles share one key store.
 */
const API_KEY_PREFIX = 'dsh-desktop-api-key'

/** @returns the saved API key for a provider, or an empty string when none is stored. */
export function getApiKey(providerId: string): string {
  try {
    return localStorage.getItem(`${API_KEY_PREFIX}:${providerId}`) ?? ''
  } catch {
    return ''
  }
}
