import { SKINS, getSkinById } from './skins.ts'

/** LocalStorage key holding the user's selected skin id. */
const STORAGE_KEY = 'dsh-desktop-skin'

/** Every custom property this plugin may set, used to clear stale overrides. */
const MANAGED_PROPERTIES: readonly string[] = [
  '--dsh-desktop-bg',
  '--dsh-desktop-surface',
  '--dsh-desktop-surface-2',
  '--dsh-desktop-fg',
  '--dsh-desktop-fg-muted',
  '--dsh-desktop-border',
  '--dsh-desktop-accent',
  '--dsh-desktop-accent-fg',
  '--dsh-desktop-code-bg',
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-elevated',
  '--dsw-alias-fg-base',
  '--dsw-alias-fg-muted',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-accent',
]

type Listener = () => void

let current = readInitial()
const listeners = new Set<Listener>()

function readInitial(): string {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (typeof stored === 'string' && SKINS.some(skin => skin.id === stored)) return stored
  } catch {
    // ignore storage access failures (private mode, headless)
  }
  return 'default'
}

/** @returns the active skin id. */
export function getSkin(): string {
  return current
}

/** Subscribe to skin changes; returns the disposer. */
export function subscribeSkin(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Select a skin by id, persist it, and apply its tokens to the document. */
export function setSkin(id: string): void {
  const next = getSkinById(id).id
  if (next === current) {
    applySkin(next)
    return
  }
  current = next
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next)
  } catch {
    // ignore persistence failures
  }
  applySkin(next)
  for (const listener of listeners) listener()
}

/** Apply the named skin's tokens onto `:root`. */
export function applySkin(id: string): void {
  const root = globalThis.document?.documentElement
  if (root === undefined) return
  if (id === 'default') {
    root.removeAttribute('data-skin')
    for (const property of MANAGED_PROPERTIES) root.style.removeProperty(property)
    return
  }
  const skin = getSkinById(id)
  root.setAttribute('data-skin', skin.id)
  for (const property of MANAGED_PROPERTIES) root.style.removeProperty(property)
  for (const [name, value] of Object.entries(skin.variables)) root.style.setProperty(name, value)
}
