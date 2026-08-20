import type { PlatformId, ToolTask } from './platform-types.ts'

const PREFIX = 'dsh-desktop-tools-tasks'

/** Load the task list for a platform (newest last). Never throws. */
export function loadTasks(platform: PlatformId): ToolTask[] {
  try {
    const raw = localStorage.getItem(`${PREFIX}:${platform}`)
    if (raw === null) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((t): t is ToolTask => typeof t === 'object' && t !== null && 'id' in t) as ToolTask[]
  } catch {
    return []
  }
}

/** Persist the task list for a platform. */
export function saveTasks(platform: PlatformId, tasks: ToolTask[]): void {
  try {
    localStorage.setItem(`${PREFIX}:${platform}`, JSON.stringify(tasks))
  } catch {
    /* ignore */
  }
}

/** Generate a reasonably unique local task id. */
export function newTaskId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
