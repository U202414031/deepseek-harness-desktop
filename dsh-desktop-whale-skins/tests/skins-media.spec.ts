import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  installSkinsRoutes, isValidMediaId, normalizeImportExt,
} from '../src/skins-host.ts'

const roots: string[] = []
const servers: Server[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-skins-'))
  roots.push(root)
  return root
}

interface TestServer {
  origin: string
  port: number
  dispose: () => void
}

/** Boot a raw node:http server wired to the skins route handlers. */
async function startSkinsServer(root: string): Promise<TestServer> {
  let routes: Array<{ kind: string; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }> = []
  const ctx = {
    webServer: {
      register: (route: { kind: string; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) => {
        routes.push(route)
        return () => { routes = routes.filter(r => r !== route) }
      },
    },
  } as unknown as Context
  const disposer = installSkinsRoutes(ctx, { root })
  const server = createServer((req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0]!
    const exact = routes.find(r => r.kind === 'exact' && r.path === urlPath)
    const prefix = routes.find(r => r.kind === 'prefix' && (urlPath === r.path || urlPath.startsWith(`${r.path}/`)))
    const handler = exact?.handler ?? prefix?.handler
    if (handler === undefined) {
      res.statusCode = 404
      res.end('no route')
      return
    }
    handler(req, res)
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    port,
    dispose: () => {
      disposer()
      server.close()
    },
  }
}

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('skins media import route', () => {
  it('uploads an image and serves it back byte-for-byte', async () => {
    const root = temporaryRoot()
    const server = await startSkinsServer(root)
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5])
    const response = await fetch(`${server.origin}/desktop/skins/media?id=media-test1&ext=png`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: bytes,
    })
    expect(response.status).toBe(200)
    const data = await response.json() as { ok: boolean; url: string }
    expect(data.ok).toBe(true)
    expect(data.url).toBe('/desktop/skins/user-imports/media-test1.png')

    const served = await fetch(`${server.origin}${data.url}`)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes)
    expect(statSync(join(root, 'user-imports', 'media-test1.png')).isFile()).toBe(true)
  })

  it('stores an mp4 with the video mime type', async () => {
    const root = temporaryRoot()
    const server = await startSkinsServer(root)
    const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])
    const response = await fetch(`${server.origin}/desktop/skins/media?id=media-video1&ext=mp4`, {
      method: 'POST',
      headers: { 'content-type': 'video/mp4' },
      body: bytes,
    })
    expect(response.status).toBe(200)
    const data = await response.json() as { ok: boolean; url: string }
    const served = await fetch(`${server.origin}${data.url}`)
    expect(served.headers.get('content-type')).toBe('video/mp4')
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes)
  })

  it('normalises jpeg uploads to the jpg extension', async () => {
    const root = temporaryRoot()
    const server = await startSkinsServer(root)
    const response = await fetch(`${server.origin}/desktop/skins/media?id=media-jpeg1&ext=jpeg`, {
      method: 'POST',
      body: new Uint8Array([1, 2, 3]),
    })
    expect(response.status).toBe(200)
    const data = await response.json() as { ok: boolean; url: string }
    expect(data.url).toBe('/desktop/skins/user-imports/media-jpeg1.jpg')
  })

  it('rejects unsupported extensions, malformed ids and wrong methods', async () => {
    const root = temporaryRoot()
    const server = await startSkinsServer(root)
    const badExt = await fetch(`${server.origin}/desktop/skins/media?id=media-x&ext=exe`, { method: 'POST', body: 'x' })
    expect(badExt.status).toBe(400)
    const badId = await fetch(`${server.origin}/desktop/skins/media?id=../evil&ext=png`, { method: 'POST', body: 'x' })
    expect(badId.status).toBe(400)
    const method = await fetch(`${server.origin}/desktop/skins/media?id=media-x&ext=png`, { method: 'GET' })
    expect(method.status).toBe(405)
    expect(existsSync(join(root, 'user-imports'))).toBe(false)
  })

  it('deletes every file belonging to a media id', async () => {
    const root = temporaryRoot()
    const server = await startSkinsServer(root)
    await fetch(`${server.origin}/desktop/skins/media?id=media-del1&ext=mp4`, { method: 'POST', body: 'v' })
    await fetch(`${server.origin}/desktop/skins/media?id=media-del1&ext=jpg`, { method: 'POST', body: 'p' })
    const deleteResponse = await fetch(`${server.origin}/desktop/skins/media?id=media-del1`, { method: 'DELETE' })
    expect(deleteResponse.status).toBe(200)
    const data = await deleteResponse.json() as { ok: boolean; removed: number }
    expect(data.ok).toBe(true)
    expect(data.removed).toBe(2)
    expect(readdirSync(join(root, 'user-imports'))).toEqual([])

    const gone = await fetch(`${server.origin}/desktop/skins/user-imports/media-del1.mp4`)
    expect(gone.status).toBe(404)
  })

  it('serves 404 for unknown assets and never escapes the root', async () => {
    const root = temporaryRoot()
    const server = await startSkinsServer(root)
    const missing = await fetch(`${server.origin}/desktop/skins/nope.png`)
    expect(missing.status).toBe(404)
    const traversal = await fetch(`${server.origin}/desktop/skins/..%2Fpackage.json`)
    expect(traversal.status).toBe(404)
  })
})

describe('skins media validation helpers', () => {
  it('accepts only safe, importable ids and extensions', () => {
    expect(isValidMediaId('media-abc123')).toBe(true)
    expect(isValidMediaId('Media_1')).toBe(false)
    expect(isValidMediaId('../x')).toBe(false)
    expect(isValidMediaId('a'.repeat(81))).toBe(false)
    expect(normalizeImportExt('PNG')).toBe('png')
    expect(normalizeImportExt('.jpeg')).toBe('jpg')
    expect(normalizeImportExt('mp4')).toBe('mp4')
    expect(normalizeImportExt('gif')).toBe('gif')
    expect(normalizeImportExt('exe')).toBeNull()
    expect(normalizeImportExt('')).toBeNull()
  })
})

describe('skins asset serving', () => {
  it('serves a pre-existing asset file with range support', async () => {
    const root = temporaryRoot()
    writeFileSync(join(root, 'sample.png'), 'hello-asset')
    const server = await startSkinsServer(root)
    const full = await fetch(`${server.origin}/desktop/skins/sample.png`)
    expect(full.status).toBe(200)
    expect(full.headers.get('accept-ranges')).toBe('bytes')
    expect(await full.text()).toBe('hello-asset')

    const ranged = await fetch(`${server.origin}/desktop/skins/sample.png`, {
      headers: { range: 'bytes=0-4' },
    })
    expect(ranged.status).toBe(206)
    expect(await ranged.text()).toBe('hello')
  })
})
