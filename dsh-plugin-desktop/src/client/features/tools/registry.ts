import type { Connector, PlatformId, PlatformMeta, ScheduleItem } from './platform-types.ts'
import { feishuConnector } from './feishu.ts'
import { wechatConnector } from './wechat.ts'
import { qqConnector } from './qq.ts'

/** All known external platforms, in tab display order. Extend here to add more. */
export const CONNECTORS: Record<PlatformId, Connector> = {
  feishu: feishuConnector,
  wechat: wechatConnector,
  qq: qqConnector,
}

/** Metadata list for rendering the platform selector. */
export const PLATFORMS: readonly PlatformMeta[] = [
  feishuConnector.meta,
  wechatConnector.meta,
  qqConnector.meta,
]

const CONFIG_PREFIX = 'dsh-desktop-tools-config'

/** @returns the saved credential values for a platform (never throws). */
export function loadToolConfig(platform: PlatformId): Record<string, string> {
  try {
    const raw = localStorage.getItem(`${CONFIG_PREFIX}:${platform}`)
    if (raw === null) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

/** Persist credential values for a platform (empty map clears storage). */
export function saveToolConfig(platform: PlatformId, values: Record<string, string>): void {
  try {
    const hasValue = Object.values(values).some((v) => v.trim().length > 0)
    if (!hasValue) {
      localStorage.removeItem(`${CONFIG_PREFIX}:${platform}`)
      return
    }
    localStorage.setItem(`${CONFIG_PREFIX}:${platform}`, JSON.stringify(values))
  } catch {
    /* storage unavailable — ignore */
  }
}

/** Remove stored credentials for a platform. */
export function clearToolConfig(platform: PlatformId): void {
  try {
    localStorage.removeItem(`${CONFIG_PREFIX}:${platform}`)
  } catch {
    /* ignore */
  }
}

const SCHEDULE_PREFIX = 'dsh-desktop-tools-schedule'

/** @returns the persisted scheduled-message list for a platform (newest-at-last order). */
export function loadToolSchedules(platform: PlatformId): ScheduleItem[] {
  try {
    const raw = localStorage.getItem(`${SCHEDULE_PREFIX}:${platform}`)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is ScheduleItem =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as ScheduleItem).id === 'string' &&
        typeof (item as ScheduleItem).at === 'number',
    )
  } catch {
    return []
  }
}

/** Persist the scheduled-message list for a platform (empty array clears storage). */
export function saveToolSchedules(platform: PlatformId, items: ScheduleItem[]): void {
  try {
    if (items.length === 0) {
      localStorage.removeItem(`${SCHEDULE_PREFIX}:${platform}`)
      return
    }
    localStorage.setItem(`${SCHEDULE_PREFIX}:${platform}`, JSON.stringify(items))
  } catch {
    /* storage unavailable — ignore */
  }
}
