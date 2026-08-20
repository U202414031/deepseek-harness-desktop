import { lstatSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureSkillsDirectoryLink } from '../src/skills-junction.ts'

const homes: string[] = []

function temporaryHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-skills-junction-'))
  homes.push(home)
  return home
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('ensureSkillsDirectoryLink', () => {
  it('creates the user directory and links a missing target to it', () => {
    const home = temporaryHome()
    const target = join(home, 'skills')
    const userDir = join(home, 'my-drive', 'dsh-skills')

    const outcome = ensureSkillsDirectoryLink(target, userDir)

    expect(outcome.created).toBe(true)
    expect(lstatSync(target).isSymbolicLink()).toBe(true)
    expect(resolve(readlinkSync(target))).toBe(resolve(userDir))
  })

  it('keeps an existing link that already points at the same directory', () => {
    const home = temporaryHome()
    const target = join(home, 'skills')
    const userDir = join(home, 'dsh-skills')

    expect(ensureSkillsDirectoryLink(target, userDir).created).toBe(true)
    const outcome = ensureSkillsDirectoryLink(target, userDir)
    expect(outcome.created).toBe(true)
    expect(outcome.reason).toBe('already linked')
  })

  it('recreates a stale link that points elsewhere', () => {
    const home = temporaryHome()
    const target = join(home, 'skills')
    const first = join(home, 'first-skills')
    const second = join(home, 'second-skills')

    expect(ensureSkillsDirectoryLink(target, first).created).toBe(true)
    expect(ensureSkillsDirectoryLink(target, second).created).toBe(true)
    expect(resolve(readlinkSync(target))).toBe(resolve(second))
  })

  it('never replaces a real directory that already holds skills', () => {
    const home = temporaryHome()
    const target = join(home, 'skills')
    writeFileSync(join(target, 'SKILL.md'), '# existing\n')
    const userDir = join(home, 'other-skills')

    const outcome = ensureSkillsDirectoryLink(target, userDir)

    expect(outcome.created).toBe(false)
    expect(outcome.reason).toContain('refusing to replace')
    // The real directory and its content stay untouched.
    expect(lstatSync(target).isSymbolicLink()).toBe(false)
  })
})
