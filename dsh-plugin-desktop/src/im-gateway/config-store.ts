/**
 * Persistent storage for the IM gateway configuration.
 *
 * Kept as a small JSON file in the user's home directory. Using a plain file
 * (instead of the dsh settings service) keeps the schema flexible and avoids
 * coupling the gateway config to a strict settings schema.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import type { ImGatewaySettings } from './types.ts'

const CONFIG_PATH = join(homedir(), '.dsh-desktop', 'im-gateway.json')

const EMPTY: ImGatewaySettings = { channels: [] }

/** Load the gateway settings, returning an empty config when none exists. */
export async function loadConfig(): Promise<ImGatewaySettings> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<ImGatewaySettings>
    if (parsed && Array.isArray(parsed.channels)) return { channels: parsed.channels }
    return EMPTY
  } catch {
    return EMPTY
  }
}

/** Persist the gateway settings. */
export async function saveConfig(settings: ImGatewaySettings): Promise<void> {
  await mkdir(join(homedir(), '.dsh-desktop'), { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify(settings, null, 2), 'utf8')
}

/** Synchronous variant used during startup before the first await. */
export function loadConfigSync(): ImGatewaySettings {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<ImGatewaySettings>
    if (parsed && Array.isArray(parsed.channels)) return { channels: parsed.channels }
    return EMPTY
  } catch {
    return EMPTY
  }
}
