import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { languageFromPath } from '../src/ide-editor-contract.ts'
import {
  handleIdeFileGetRequest,
  handleIdeFileWriteRequest,
  handleIdeTreeRequest,
  handleIdeWorkspaceRequest,
  resolveAllowedPath,
} from '../src/ide-editor-routes.ts'

const ORIGIN = 'http://127.0.0.1:43120'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ide-editor-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

function request(origin: string | undefined, method: string, url: string): IncomingMessage {
  return {
    method,
    url,
    headers: { origin, host: '127.0.0.1:43120' },
  } as IncomingMessage
}

function response(): ServerResponse & {
  body: string
  end: ReturnType<typeof vi.fn>
  setHeader: ReturnType<typeof vi.fn>
} {
  const res = {
    body: '',
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn((body?: string) => { res.body = body ?? '' }),
  }
  return res as unknown as ServerResponse & typeof res
}

describe('languageFromPath', () => {
  it('derives the language from common extensions', () => {
    expect(languageFromPath('C:\\work\\a.ts')).toBe('typescript')
    expect(languageFromPath('/x/main.py')).toBe('python')
    expect(languageFromPath('index.jsx')).toBe('javascript')
    expect(languageFromPath('data.json')).toBe('json')
    expect(languageFromPath('README.md')).toBe('markdown')
  })

  it('falls back to plaintext for unknown or extension-less files', () => {
    expect(languageFromPath('Makefile')).toBe('plaintext')
    expect(languageFromPath('archive.tar.gz')).toBe('plaintext')
  })
})

describe('resolveAllowedPath', () => {
  it('accepts paths inside a root and canonicalizes them', () => {
    const root = makeTempDir()
    const file = join(root, 'sub', 'a.txt')
    mkdirSync(join(root, 'sub'), { recursive: true })
    writeFileSync(file, 'x')
    expect(resolveAllowedPath([root], file)).toBe(file)
    expect(resolveAllowedPath([root], join(root, 'sub'))).toBe(join(root, 'sub'))
  })

  it('rejects paths outside every root', () => {
    const root = makeTempDir()
    const outside = makeTempDir()
    expect(resolveAllowedPath([root], outside)).toBeNull()
    expect(resolveAllowedPath([root], join(outside, 'file.txt'))).toBeNull()
  })

  it('rejects traversal attempts', () => {
    const root = makeTempDir()
    const escaped = join(root, '..', 'escaped')
    expect(resolveAllowedPath([root], escaped)).toBeNull()
  })

  it('accepts not-yet-existing write targets inside a root', () => {
    const root = makeTempDir()
    const target = join(root, 'new', 'dir', 'file.txt')
    expect(resolveAllowedPath([root], target)).toBe(target)
  })

  it('drops roots that do not exist', () => {
    const root = makeTempDir()
    const missing = join(root, 'nope')
    expect(resolveAllowedPath([missing, root], join(root, 'ok.txt'))).toBe(join(root, 'ok.txt'))
    expect(resolveAllowedPath([missing], join(root, 'ok.txt'))).toBeNull()
  })

  it('rejects a symlink escaping the root (POSIX only; Windows needs privileges)', () => {
    const root = makeTempDir()
    const outside = makeTempDir()
    mkdirSync(join(root, 'inner'), { recursive: true })
    let link: string | undefined
    try {
      link = join(root, 'inner', 'escape')
      symlinkSync(outside, link, 'junction')
    } catch {
      return // no symlink privileges on this machine — skip
    }
    expect(resolveAllowedPath([root], link)).toBeNull()
    expect(resolveAllowedPath([root], join(link, 'file.txt'))).toBeNull()
  })
})

describe('handleIdeTreeRequest', () => {
  it('returns the normalized workspace roots', () => {
    const root = makeTempDir()
    const res = response()
    handleIdeTreeRequest(request(ORIGIN, 'GET', '/_dsh/desktop/ide/tree'), res, ORIGIN, () => [root])
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { roots: Array<{ name: string; path: string }> }
    expect(body.roots).toEqual([{ name: root.split(/[\\/]/).pop(), path: root }])
  })

  it('lists a directory with dirs first, then files, sorted', () => {
    const root = makeTempDir()
    writeFileSync(join(root, 'b.txt'), 'b')
    writeFileSync(join(root, 'a.txt'), 'a')
    mkdirSync(join(root, 'zeta'))
    mkdirSync(join(root, 'alpha'))
    const res = response()
    handleIdeTreeRequest(
      request(ORIGIN, 'GET', `/_dsh/desktop/ide/tree?path=${encodeURIComponent(root)}`),
      res,
      ORIGIN,
      () => [root],
    )
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { entries: Array<{ name: string; type: string }> }
    expect(body.entries.map(e => `${e.type}:${e.name}`)).toEqual([
      'dir:alpha',
      'dir:zeta',
      'file:a.txt',
      'file:b.txt',
    ])
  })

  it('rejects paths outside the allowed roots', () => {
    const root = makeTempDir()
    const outside = makeTempDir()
    const res = response()
    handleIdeTreeRequest(
      request(ORIGIN, 'GET', `/_dsh/desktop/ide/tree?path=${encodeURIComponent(outside)}`),
      res,
      ORIGIN,
      () => [root],
    )
    expect(res.statusCode).toBe(403)
  })
})

describe('handleIdeFileGetRequest', () => {
  it('returns file content with a derived language', () => {
    const root = makeTempDir()
    const file = join(root, 'app.ts')
    writeFileSync(file, 'const x: number = 1', 'utf8')
    const res = response()
    handleIdeFileGetRequest(
      request(ORIGIN, 'GET', `/_dsh/desktop/ide/file?path=${encodeURIComponent(file)}`),
      res,
      ORIGIN,
      () => [root],
    )
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { content: string; language: string; path: string }
    expect(body.content).toBe('const x: number = 1')
    expect(body.language).toBe('typescript')
    expect(body.path).toBe(file)
  })

  it('rejects binary files', () => {
    const root = makeTempDir()
    const file = join(root, 'bin.dat')
    writeFileSync(file, Buffer.from([0, 1, 2, 3, 0]))
    const res = response()
    handleIdeFileGetRequest(
      request(ORIGIN, 'GET', `/_dsh/desktop/ide/file?path=${encodeURIComponent(file)}`),
      res,
      ORIGIN,
      () => [root],
    )
    expect(res.statusCode).toBe(415)
  })

  it('rejects files outside the allowed roots', () => {
    const root = makeTempDir()
    const outside = makeTempDir()
    const file = join(outside, 'x.txt')
    writeFileSync(file, 'x')
    const res = response()
    handleIdeFileGetRequest(
      request(ORIGIN, 'GET', `/_dsh/desktop/ide/file?path=${encodeURIComponent(file)}`),
      res,
      ORIGIN,
      () => [root],
    )
    expect(res.statusCode).toBe(403)
  })
})

describe('handleIdeFileWriteRequest', () => {
  it('creates nested files and writes content', async () => {
    const root = makeTempDir()
    const target = join(root, 'deep', 'dir', 'note.txt')
    const res = response()
    await handleIdeFileWriteRequest(patchedRequest(target, 'hello'), res, ORIGIN, () => [root])
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('"ok":true')
    expect((await import('node:fs')).readFileSync(target, 'utf8')).toBe('hello')
  })

  it('rejects writes outside the allowed roots', async () => {
    const root = makeTempDir()
    const outside = makeTempDir()
    const res = response()
    await handleIdeFileWriteRequest(patchedRequest(join(outside, 'x.txt'), 'x'), res, ORIGIN, () => [root])
    expect(res.statusCode).toBe(403)
  })
})

describe('handleIdeWorkspaceRequest', () => {
  it('delegates a validated directory to the workspace registrar', async () => {
    const root = makeTempDir()
    const dir = join(root, 'project')
    mkdirSync(dir, { recursive: true })
    const created: string[] = []
    const res = response()
    await handleIdeWorkspaceRequest(
      bodyRequest({ dir }),
      res,
      ORIGIN,
      () => [root],
      async (canonical: string) => { created.push(canonical) },
    )
    expect(res.statusCode).toBe(200)
    expect(created).toEqual([dir])
    expect(res.body).toContain('"ok":true')
  })

  it('rejects directories outside the allowed roots', async () => {
    const root = makeTempDir()
    const outside = makeTempDir()
    const created: string[] = []
    const res = response()
    await handleIdeWorkspaceRequest(
      bodyRequest({ dir: outside }),
      res,
      ORIGIN,
      () => [root],
      async (canonical: string) => { created.push(canonical) },
    )
    expect(res.statusCode).toBe(403)
    expect(created).toEqual([])
  })
})

/** Build a request whose POST body carries an arbitrary JSON payload. */
function bodyRequest(payload: object): IncomingMessage {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const listeners: Record<string, Array<(chunk?: Buffer) => void>> = {}
  const req = {
    method: 'POST',
    url: '/_dsh/desktop/ide/file',
    headers: { origin: ORIGIN, host: '127.0.0.1:43120' },
    on(event: string, cb: (chunk?: Buffer) => void): unknown {
      (listeners[event] ??= []).push(cb)
      if (event === 'data') queueMicrotask(() => cb(body))
      if (event === 'end') queueMicrotask(() => cb())
      return req
    },
    destroy(): void { /* no-op */ },
  }
  return req as unknown as IncomingMessage
}

/** Build a request whose POST body carries { path, content }. */
function patchedRequest(path: string, content: string): IncomingMessage {
  return bodyRequest({ path, content })
}
