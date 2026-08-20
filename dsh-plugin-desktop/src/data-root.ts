/**
 * Desktop-owned unified data root.
 *
 * Every desktop-owned data location (DSH home, shared Agent skills, the file
 * upload dropbox, Electron user data, and the auxiliary `.dsh-desktop`
 * directory) can be redirected under one user-chosen root directory. The root
 * is resolved once at launcher startup from, in priority order:
 *
 *   1. the `DSH_DESKTOP_DATA_DIR` environment variable, or
 *   2. the `dsh-desktop.dataDir` value in the DSH home `settings.yaml`, or
 *   3. nothing (all locations keep their platform defaults).
 *
 * From the root, subdirectories are derived so every consumer gets one
 * consistent location:
 *
 *   <root>/dsh      -> DSH_HOME (profiles, sessions, storages, settings)
 *   <root>/agents   -> DSH_AGENTS_HOME (shared Agent skills)
 *   <root>/dropbox  -> DSH_DROPBOX_DIR (file-upload staging)
 *   <root>/desktop  -> Electron userData (logs, updates, crash evidence)
 *   <root>/aux      -> replacement for `~/.dsh-desktop` (IM gateway, IDE bridge)
 *
 * The launcher applies the redirect before any data access, so every file —
 * existing or future — lives under the chosen root.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseDocument } from 'yaml'

/** The desktop settings namespace owning `dataDir`. */
export const DESKTOP_SETTINGS_NAMESPACE = 'dsh-desktop'

/** Where a resolved data root came from; used by the settings surface. */
export type DesktopDataRootSource = 'env' | 'settings' | 'none'

/** Resolved data root plus its provenance. */
export interface DesktopDataRoot {
  /** Absolute data root directory, or undefined when not configured. */
  root: string | undefined
  /** Where the value was read from. */
  source: DesktopDataRootSource
}

/** Subdirectories derived from one data root. */
export interface DerivedDataDirs {
  dshHome: string
  agentsHome: string
  dropboxDir: string
  desktopUserData: string
  auxDir: string
}

/** Derive every desktop data location from one root. */
export function deriveDataDirs(root: string): DerivedDataDirs {
  return {
    dshHome: resolve(root, 'dsh'),
    agentsHome: resolve(root, 'agents'),
    dropboxDir: resolve(root, 'dropbox'),
    desktopUserData: resolve(root, 'desktop'),
    auxDir: resolve(root, 'aux'),
  }
}

/** Read the optional `dsh-desktop.dataDir` string from a parsed settings document. */
export function readDataDirFromSettingsDocument(document: unknown): string | undefined {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return undefined
  const section = (document as Record<string, unknown>)[DESKTOP_SETTINGS_NAMESPACE]
  if (typeof section !== 'object' || section === null || Array.isArray(section)) return undefined
  const value = (section as Record<string, unknown>).dataDir
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  return value.trim()
}

/** Parse a DSH home settings document from disk (YAML or JSON). */
export function readSettingsDocumentFromHome(dshHome: string): unknown {
  const candidates = [`${dshHome}/settings.yaml`, `${dshHome}/settings.yml`, `${dshHome}/settings.json`]
  for (const filename of candidates) {
    let text: string
    try {
      text = readFileSync(filename, 'utf8')
    } catch {
      continue
    }
    if (filename.endsWith('.json')) {
      const trimmed = text.trim()
      if (trimmed.length === 0) return {}
      try {
        return JSON.parse(trimmed) as unknown
      } catch {
        return undefined
      }
    }
    const parsed = parseDocument(text, { prettyErrors: true })
    if (parsed.errors.length > 0) return undefined
    return parsed.toJS() ?? {}
  }
  return {}
}

/**
 * Resolve the data root for one launch.
 * @param env - process environment snapshot (defaults to `process.env`).
 * @param settingsDoc - parsed DSH home settings document; defaults to reading
 *   from the current DSH home so a `dataDir` configured in settings works even
 *   before the environment redirect is applied.
 */
export function resolveDesktopDataRoot(
  env: NodeJS.ProcessEnv = process.env,
  settingsDoc?: unknown,
): DesktopDataRoot {
  const fromEnv = env.DSH_DESKTOP_DATA_DIR
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    return { root: resolve(fromEnv.trim()), source: 'env' }
  }
  const fromSettings = readDataDirFromSettingsDocument(settingsDoc)
  if (fromSettings !== undefined) {
    return { root: resolve(fromSettings), source: 'settings' }
  }
  return { root: undefined, source: 'none' }
}
