/**
 * Desktop-owned skill directory relocation.
 *
 * DSH resolves user skills as `$DSH_HOME/skills` and shared Agent skills as
 * `$DSH_AGENTS_HOME/skills` (upstream `dsh-skill-filesystem` and the
 * `@michengai/dsh-skills-manager` plugin both derive these from the same two
 * roots). The launcher honors two optional `dsh-desktop.skills` settings:
 *
 * - `agentsDir` — injected as the `DSH_AGENTS_HOME` environment variable before
 *   the Host boots, so every skill consumer agrees on the relocated shared root.
 * - `dshDir` — the `$DSH_HOME/skills` path is linked (Windows junction, or a
 *   directory symlink elsewhere) to this user-owned directory, so the physical
 *   files can live on any drive while the logical path stays unchanged.
 *
 * The link is created only when the target does not exist as a real directory;
 * an existing real directory (user skills already present) is never replaced.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'

/** Outcome of one ensure call, used by the launcher for a log line. */
export interface SkillsLinkOutcome {
  created: boolean
  /** Human-readable reason when the link was not (re)created. */
  reason?: string
}

/** Whether `path` is a directory link (Windows junction or symlink). */
function isDirectoryLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

/** The path a directory link points at, when it is one. */
function linkTarget(path: string): string | undefined {
  try {
    return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : undefined
  } catch {
    return undefined
  }
}

/**
 * Ensure `target` is a directory link to `userDir`, creating the user directory
 * when missing. Never replaces a real directory that already holds skills.
 * @param target - logical path that must stay stable (e.g. `$DSH_HOME/skills`).
 * @param userDir - user-chosen physical directory (may be on another drive).
 * @param platform - Node platform selecting junction vs directory symlink.
 */
export function ensureSkillsDirectoryLink(
  target: string,
  userDir: string,
  platform: NodeJS.Platform = process.platform,
): SkillsLinkOutcome {
  const physical = resolve(userDir)
  try {
    mkdirSync(physical, { recursive: true })
  } catch (cause) {
    return { created: false, reason: `cannot create skills directory ${physical}: ${cause instanceof Error ? cause.message : String(cause)}` }
  }
  if (isDirectoryLink(target)) {
    // Already linked; recreate only when it points somewhere else.
    const current = linkTarget(target)
    if (current !== undefined && resolve(current) === resolve(physical)) {
      return { created: true, reason: 'already linked' }
    }
    try {
      rmSync(target, { recursive: false })
    } catch (cause) {
      return { created: false, reason: `cannot replace stale skills link ${target}: ${cause instanceof Error ? cause.message : String(cause)}` }
    }
  } else if (existsSync(target)) {
    return { created: false, reason: `refusing to replace existing skills directory ${target}` }
  }
  try {
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(physical, target, platform === 'win32' ? 'junction' : 'dir')
    return { created: true }
  } catch (cause) {
    return { created: false, reason: `cannot link ${target} to ${physical}: ${cause instanceof Error ? cause.message : String(cause)}` }
  }
}
