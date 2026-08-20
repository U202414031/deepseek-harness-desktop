import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deriveDataDirs,
  readDataDirFromSettingsDocument,
  readSettingsDocumentFromHome,
  resolveDesktopDataRoot,
} from '../src/data-root.ts'

const homes: string[] = []

function temporaryHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-data-root-'))
  homes.push(home)
  return home
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('resolveDesktopDataRoot', () => {
  it('prefers the DSH_DESKTOP_DATA_DIR environment variable', () => {
    const result = resolveDesktopDataRoot({ DSH_DESKTOP_DATA_DIR: 'D:/MyData/desktop-data' }, {
      'dsh-desktop': { dataDir: 'C:/ignored' },
    })
    expect(result.source).toBe('env')
    expect(result.root).toBe('D:\\MyData\\desktop-data')
  })

  it('falls back to the settings document value', () => {
    const result = resolveDesktopDataRoot({}, { 'dsh-desktop': { dataDir: 'D:/FromSettings' } })
    expect(result.source).toBe('settings')
    expect(result.root).toBe('D:\\FromSettings')
  })

  it('returns none when neither source is configured', () => {
    const result = resolveDesktopDataRoot({}, { 'dsh-desktop': { mode: 'advanced' } })
    expect(result.source).toBe('none')
    expect(result.root).toBeUndefined()
  })

  it('ignores blank environment values', () => {
    const result = resolveDesktopDataRoot({ DSH_DESKTOP_DATA_DIR: '   ' }, {})
    expect(result.source).toBe('none')
  })
})

describe('deriveDataDirs', () => {
  it('derives every desktop data location from one root', () => {
    expect(deriveDataDirs('D:/MyData/desktop-data')).toEqual({
      dshHome: 'D:\\MyData\\desktop-data\\dsh',
      agentsHome: 'D:\\MyData\\desktop-data\\agents',
      dropboxDir: 'D:\\MyData\\desktop-data\\dropbox',
      desktopUserData: 'D:\\MyData\\desktop-data\\desktop',
      auxDir: 'D:\\MyData\\desktop-data\\aux',
    })
  })
})

describe('readDataDirFromSettingsDocument', () => {
  it('reads the dsh-desktop.dataDir string', () => {
    expect(readDataDirFromSettingsDocument({ 'dsh-desktop': { dataDir: 'D:/x' } })).toBe('D:/x')
  })

  it('returns undefined for missing, empty, or non-string values', () => {
    expect(readDataDirFromSettingsDocument({})).toBeUndefined()
    expect(readDataDirFromSettingsDocument({ 'dsh-desktop': {} })).toBeUndefined()
    expect(readDataDirFromSettingsDocument({ 'dsh-desktop': { dataDir: '' } })).toBeUndefined()
    expect(readDataDirFromSettingsDocument({ 'dsh-desktop': { dataDir: 42 } })).toBeUndefined()
    expect(readDataDirFromSettingsDocument('nope')).toBeUndefined()
  })
})

describe('readSettingsDocumentFromHome', () => {
  it('parses a YAML settings document and reads dataDir through the full chain', () => {
    const home = temporaryHome()
    writeFileSync(join(home, 'settings.yaml'), [
      'ui-onboarding:',
      '  welcomeNoticeVersion: 2026-08-13.1',
      'dsh-desktop:',
      '  mode: advanced',
      '  dataDir: "D:/MyData/desktop-data"',
    ].join('\n'))

    const document = readSettingsDocumentFromHome(home)
    const result = resolveDesktopDataRoot({}, document)
    expect(result.source).toBe('settings')
    expect(result.root).toBe('D:\\MyData\\desktop-data')
  })

  it('returns an empty document when the home has no settings file', () => {
    const home = temporaryHome()
    expect(readSettingsDocumentFromHome(home)).toEqual({})
  })
})
