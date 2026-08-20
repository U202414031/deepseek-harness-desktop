import { afterEach, describe, expect, it, vi } from 'vitest'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { originAllowed, writeEmbeddedIdeBridgeConfig, writeIdeBridgeConfig } from '../src/ide-routes.ts'
import {
  buildEmbeddedArgs,
  pickFreePort,
  resolveEmbeddedServerRoot,
  startIdeServer,
  waitForHttp,
} from '../src/ide-server.ts'
import { DESKTOP_IDE_ASK_PATH } from '../src/ide-info-contract.ts'

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

/** Minimal fake openvscode-server release: real node + a tiny HTTP server main. */
function makeFakeRelease(root: string): void {
  mkdirSync(join(root, 'out'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'openvscode-server-fake' }), 'utf8')
  writeFileSync(join(root, 'out', 'server-main.js'), [
    'const http = require("node:http")',
    'const port = Number(process.argv[process.argv.indexOf("--port") + 1])',
    'const server = http.createServer((_req, res) => { res.statusCode = 200; res.end("ok") })',
    'server.listen(port, "127.0.0.1", () => process.stdout.write("ready\\n"))',
    'process.on("SIGTERM", () => process.exit(0))',
  ].join('\n'), 'utf8')
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
  cpSync(process.execPath, join(root, nodeName))
}

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ide-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  delete process.env.DSH_OPENVSCODE_SERVER_PATH
})

describe('originAllowed', () => {
  it('trusts missing origins (native callers / same-origin GETs)', () => {
    expect(originAllowed(undefined, 'http://127.0.0.1:43120')).toBe(true)
  })

  it('trusts the exact renderer origin', () => {
    expect(originAllowed('http://127.0.0.1:43120', 'http://127.0.0.1:43120')).toBe(true)
  })

  it('trusts other loopback origins (the embedded IDE server)', () => {
    expect(originAllowed('http://127.0.0.1:51234', 'http://127.0.0.1:43120')).toBe(true)
    expect(originAllowed('http://localhost:51234', 'http://127.0.0.1:43120')).toBe(true)
  })

  it('rejects arbitrary web origins', () => {
    expect(originAllowed('https://evil.example', 'http://127.0.0.1:43120')).toBe(false)
    expect(originAllowed('http://192.168.1.5:51234', 'http://127.0.0.1:43120')).toBe(false)
    expect(originAllowed('http://localhost.evil.example', 'http://127.0.0.1:43120')).toBe(false)
  })

  it('still trusts loopback origins over https (local services)', () => {
    expect(originAllowed('https://127.0.0.1:51234', 'http://127.0.0.1:43120')).toBe(true)
  })
})

describe('buildEmbeddedArgs', () => {
  it('passes loopback binding, workspace root and managed dirs', () => {
    const args = buildEmbeddedArgs({
      serverMain: 'C:\\ide\\out\\server-main.js',
      port: 40001,
      profileDir: 'C:\\profiles\\desktop',
      extensionsDir: 'C:\\profiles\\desktop\\.dsh-ide\\extensions',
      userDataDir: 'C:\\profiles\\desktop\\.dsh-ide\\user-data',
    })
    expect(args).toEqual([
      'C:\\ide\\out\\server-main.js',
      '--host', '127.0.0.1',
      '--port', '40001',
      '--without-connection-token',
      '--extensions-dir', 'C:\\profiles\\desktop\\.dsh-ide\\extensions',
      '--user-data-dir', 'C:\\profiles\\desktop\\.dsh-ide\\user-data',
      '--default-folder', 'C:\\profiles\\desktop',
      '--disable-telemetry',
    ])
  })
})

describe('resolveEmbeddedServerRoot', () => {
  it('resolves the env override when it looks like a release', () => {
    const root = makeTempDir()
    makeFakeRelease(root)
    process.env.DSH_OPENVSCODE_SERVER_PATH = root
    expect(resolveEmbeddedServerRoot()).toBe(root)
  })

  it('returns null for a folder without a release layout', () => {
    const root = makeTempDir()
    writeFileSync(join(root, 'package.json'), '{}', 'utf8')
    process.env.DSH_OPENVSCODE_SERVER_PATH = root
    expect(resolveEmbeddedServerRoot()).toBeNull()
  })

  it('returns null when no runtime is present anywhere', () => {
    expect(resolveEmbeddedServerRoot()).toBeNull()
  })
})

describe('pickFreePort / waitForHttp', () => {
  it('picks an open loopback port', async () => {
    const port = await pickFreePort()
    expect(port).toBeGreaterThan(0)
    expect(port).toBeLessThan(65_536)
  })

  it('reports readiness once the endpoint answers 200', async () => {
    const server: Server = createServer((_req, res) => {
      res.statusCode = 200
      res.end('ok')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    try {
      expect(await waitForHttp(`http://127.0.0.1:${port}/`, 5_000)).toBe(true)
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('fails when nothing answers', async () => {
    const port = await pickFreePort()
    expect(await waitForHttp(`http://127.0.0.1:${port}/`, 800)).toBe(false)
  })
})

describe('startIdeServer embedded lifecycle', () => {
  it('starts a fake openvscode-server and reports ready with a URL', async () => {
    const release = makeTempDir()
    makeFakeRelease(release)
    process.env.DSH_OPENVSCODE_SERVER_PATH = release
    const profileDir = makeTempDir()
    const ctx = { logger: fakeLogger() } as never

    const handle = startIdeServer({
      ctx,
      rendererOrigin: 'http://127.0.0.1:43120',
      profileDir,
      allowedDirs: [],
    })

    try {
      const before = handle.getInfo()
      expect(before.mode).toBe('embedded')
      expect(before.status).toBe('stopped')
      expect(before.url).toBeNull()

      await handle.ensureStarted()

      const info = handle.getInfo()
      expect(info.status).toBe('ready')
      expect(info.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
      expect(handle.getUrl()).toBe(info.url)

      // The bridge config file for the embedded extension exists.
      const bridgeFile = join(profileDir, '.dsh-ide', '.dsh-ide-bridge.json')
      expect(existsSync(bridgeFile)).toBe(true)
      expect(JSON.parse(readFileSync(bridgeFile, 'utf8'))).toEqual({
        baseUrl: 'http://127.0.0.1:43120',
        askPath: DESKTOP_IDE_ASK_PATH,
      })

      // ensureStarted is idempotent while running.
      await handle.ensureStarted()
      expect(handle.getInfo().status).toBe('ready')
    } finally {
      handle.dispose()
    }
  })

  it('reports missing when no runtime is bundled', () => {
    const profileDir = makeTempDir()
    const handle = startIdeServer({
      ctx: { logger: fakeLogger() } as never,
      rendererOrigin: 'http://127.0.0.1:43120',
      profileDir,
      allowedDirs: [],
    })
    const info = handle.getInfo()
    expect(info.mode).toBe('external')
    expect(info.status).toBe('missing')
    expect(info.url).toBeNull()
    handle.dispose()
  })
})

describe('bridge config writers', () => {
  it('writes the embedded config next to the extensions dir', () => {
    const profileDir = makeTempDir()
    writeEmbeddedIdeBridgeConfig(profileDir, 'http://127.0.0.1:43120', DESKTOP_IDE_ASK_PATH)
    const file = join(profileDir, '.dsh-ide', '.dsh-ide-bridge.json')
    expect(existsSync(file)).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      baseUrl: 'http://127.0.0.1:43120',
      askPath: DESKTOP_IDE_ASK_PATH,
    })
  })

  it('writes both the profile and user-level linkage configs', () => {
    const profileDir = makeTempDir()
    const homeDir = makeTempDir()
    writeIdeBridgeConfig(profileDir, 'http://127.0.0.1:43120', DESKTOP_IDE_ASK_PATH, homeDir)
    expect(JSON.parse(readFileSync(join(profileDir, '.dsh-ide-bridge.json'), 'utf8'))).toEqual({
      baseUrl: 'http://127.0.0.1:43120',
      askPath: DESKTOP_IDE_ASK_PATH,
    })
    // The native VS Code extension reads the user-level file without the dot.
    expect(JSON.parse(readFileSync(join(homeDir, '.dsh-desktop', 'ide-bridge.json'), 'utf8'))).toEqual({
      baseUrl: 'http://127.0.0.1:43120',
      askPath: DESKTOP_IDE_ASK_PATH,
    })
  })
})
