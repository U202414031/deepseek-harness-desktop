/** Persisted IDE workspace configuration for the active desktop profile. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Workspace directories the embedded IDE is permitted to open. */
export interface IdeConfig {
  /** Absolute directories exposed to the IDE as workspace folders. */
  allowedDirs: string[]
}

const CONFIG_NAME = '.dsh-ide.json'

/** Absolute path of the IDE config file inside a profile directory. */
export function ideConfigPath(profileDir: string): string {
  return join(profileDir, CONFIG_NAME)
}

/** Load the IDE config, falling back to an empty allow-list when absent or invalid. */
export function loadIdeConfig(profileDir: string): IdeConfig {
  try {
    const raw = readFileSync(ideConfigPath(profileDir), 'utf8')
    const parsed = JSON.parse(raw) as Partial<IdeConfig>
    if (Array.isArray(parsed.allowedDirs)) {
      return { allowedDirs: parsed.allowedDirs.filter((dir): dir is string => typeof dir === 'string') }
    }
  } catch {
    // No config yet, or unreadable — fall through to the default.
  }
  return { allowedDirs: [] }
}

/** Persist the IDE config. @param profileDir - active profile directory. */
export function saveIdeConfig(profileDir: string, config: IdeConfig): void {
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(ideConfigPath(profileDir), JSON.stringify(config, null, 2), 'utf8')
}
