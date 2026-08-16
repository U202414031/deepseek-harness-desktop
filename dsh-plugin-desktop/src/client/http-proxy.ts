/**
 * Client-side carrier for the Host HTTP proxy (`/desktop/proxy`).
 *
 * Every cross-origin call from the sandboxed renderer should go through
 * `proxyFetch` instead of `fetch`: it tunnels the request to the Host process,
 * which performs the real `fetch` (Node, no CORS) and streams the response back.
 * The route is same-origin (the renderer is served from the loopback web server),
 * so even the tunnel request itself is CORS-free.
 *
 * If the proxy route is unreachable for any reason, it transparently falls back
 * to a direct `fetch` (which matches the pre-proxy behavior).
 */

const PROXY_PATH = '/desktop/proxy'

/** Collect request headers into a plain string map, tolerant of HeadersInit shapes. */
function collectHeaders(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  const src = init?.headers
  if (src === undefined) return out
  if (Array.isArray(src)) {
    for (const [key, value] of src) out[key] = value
  } else if (typeof Headers !== 'undefined' && src instanceof Headers) {
    src.forEach((value, key) => { out[key] = value })
  } else {
    for (const [key, value] of Object.entries(src as Record<string, string>)) {
      if (typeof value === 'string') out[key] = value
    }
  }
  return out
}

/**
 * Perform an HTTP request through the Host proxy.
 * @param input - absolute upstream URL (http/https).
 * @param init - standard fetch init; the real method/headers/body are forwarded.
 */
export async function proxyFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input.toString()
  const method = init?.method ?? 'GET'
  const headers = collectHeaders(init)
  const proxyInit: RequestInit = {
    method: 'POST',
    headers: { ...headers, 'x-proxy-url': url, 'x-proxy-method': method },
  }
  if (init?.body !== undefined) proxyInit.body = init.body
  try {
    return await fetch(PROXY_PATH, proxyInit)
  } catch {
    // Proxy route unreachable — fall back to a direct request (may be blocked by CORS).
    return fetch(input, init)
  }
}
