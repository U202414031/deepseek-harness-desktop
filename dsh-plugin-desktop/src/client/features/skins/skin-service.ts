import { SKINS, type Skin, getSkinById as getBuiltinSkin } from './skins.ts'

/** LocalStorage key holding the user's selected skin id. */
const STORAGE_KEY = 'dsh-desktop-skin'
/** LocalStorage key holding user-created skins. */
const CUSTOM_KEY = 'dsh-desktop-custom-skins'

type Listener = () => void

let current = readInitial()
const skinListeners = new Set<Listener>()
const catalogListeners = new Set<Listener>()
/** Properties applied by the previously active skin, so we can clear them on switch. */
let lastProperties: string[] = []

function readInitial(): string {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (typeof stored === 'string' && getCatalog().some(skin => skin.id === stored)) return stored
  } catch {
    // ignore storage access failures (private mode, headless)
  }
  return 'default'
}

/** @returns the full skin catalog: built-in skins followed by user-created ones. */
export function getCatalog(): Skin[] {
  return [...SKINS, ...loadCustomSkins()]
}

/** Resolve a skin definition by id, falling back to the default skin. */
export function getSkinById(id: string): Skin {
  return getCatalog().find(skin => skin.id === id) ?? getBuiltinSkin(id) ?? SKINS[0]!
}

/** @returns the active skin id. */
export function getSkin(): string {
  return current
}

/** Subscribe to the active-skin id; returns the disposer. */
export function subscribeSkin(listener: Listener): () => void {
  skinListeners.add(listener)
  return () => { skinListeners.delete(listener) }
}

/** Subscribe to catalog changes (custom skins added/removed); returns the disposer. */
export function subscribeCatalog(listener: Listener): () => void {
  catalogListeners.add(listener)
  return () => { catalogListeners.delete(listener) }
}

/** Persist a user-created skin; replaces an existing one with the same id. */
export function saveCustomSkin(skin: Skin): void {
  const next = loadCustomSkins().filter(existing => existing.id !== skin.id).concat(skin)
  persistCustomSkins(next)
  for (const listener of catalogListeners) listener()
  if (current === skin.id) applySkin(skin.id)
}

/** Remove a user-created skin by id. */
export function deleteCustomSkin(id: string): void {
  persistCustomSkins(loadCustomSkins().filter(existing => existing.id !== id))
  for (const listener of catalogListeners) listener()
  if (current === id) setSkin('default')
}

/**
 * Validate and normalize an externally-provided skin definition (e.g. pasted or
 * uploaded JSON). Returns a ready-to-persist `Skin`, or `null` when the payload
 * is not a usable skin. A fresh id is assigned to avoid clashing with built-ins.
 */
export function parseImportedSkin(raw: unknown): Skin | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const variables = record.variables
  if (typeof variables !== 'object' || variables === null) return null
  const varRecord = variables as Record<string, unknown>
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(varRecord)) {
    if (typeof value === 'string' && key.startsWith('--')) normalized[key] = value
  }
  if (Object.keys(normalized).length === 0) return null
  const label = typeof record.label === 'string' && record.label.trim().length > 0 ? record.label.trim() : '导入的皮肤'
  const description = typeof record.description === 'string' ? record.description : '从外部导入的自定义皮肤。'
  return { id: `import-${Date.now().toString(36)}`, label, description, variables: normalized, custom: true }
}

/** Serialize a skin definition to a portable JSON string for export. */
export function exportCustomSkin(skin: Skin): string {
  return JSON.stringify({ id: skin.id, label: skin.label, description: skin.description, variables: skin.variables }, null, 2)
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
  for (const listener of skinListeners) listener()
}

/** Apply the named skin's tokens onto `:root`, clearing the prior skin first. */
export function applySkin(id: string): void {
  const root = globalThis.document?.documentElement
  if (root === undefined) return
  for (const property of lastProperties) root.style.removeProperty(property)
  lastProperties = []
  if (id === 'default') {
    root.removeAttribute('data-skin')
    return
  }
  const skin = getSkinById(id)
  root.setAttribute('data-skin', skin.id)
  const names = Object.keys(skin.variables)
  for (const [name, value] of Object.entries(skin.variables)) root.style.setProperty(name, value)
  lastProperties = names
}

interface StoredSkin {
  id: string
  label: string
  description: string
  variables: Record<string, string>
  custom?: boolean
}

function isSkin(value: unknown): value is Skin {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (value as StoredSkin).id === 'string'
    && typeof (value as StoredSkin).variables === 'object'
    && (value as StoredSkin).variables !== null
  )
}

function loadCustomSkins(): Skin[] {
  try {
    const raw = globalThis.localStorage?.getItem(CUSTOM_KEY)
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.filter(isSkin)
    }
  } catch {
    // ignore storage failures
  }
  return []
}

function persistCustomSkins(skins: Skin[]): void {
  try {
    globalThis.localStorage?.setItem(CUSTOM_KEY, JSON.stringify(skins))
  } catch {
    // ignore persistence failures
  }
}
