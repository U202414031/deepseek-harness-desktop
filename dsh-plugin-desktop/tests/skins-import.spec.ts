import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Skin } from '../src/client/features/skins/skins.ts'
import { parseImportedSkin } from '../src/client/features/skins/skin-service.ts'
import {
  buildMediaPalette, buildMediaVariables, classifyMediaFile, deleteImportedMedia,
  importMediaSkin, importedMediaIds, mixRgb, relativeLuminance, rgbToHex, uploadMedia,
} from '../src/client/features/skins/skins-import.ts'

function file(name: string, type: string, content = 'x'): File {
  return new File([content], name, { type })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('classifyMediaFile', () => {
  it('classifies static image types', () => {
    expect(classifyMediaFile(file('wallpaper.jpg', 'image/jpeg'))).toEqual({ kind: 'image', ext: 'jpg' })
    expect(classifyMediaFile(file('wallpaper.png', 'image/png'))).toEqual({ kind: 'image', ext: 'png' })
    expect(classifyMediaFile(file('wallpaper.webp', 'image/webp'))).toEqual({ kind: 'image', ext: 'webp' })
    expect(classifyMediaFile(file('sticker.gif', 'image/gif'))).toEqual({ kind: 'image', ext: 'gif' })
  })

  it('classifies animated / video types', () => {
    expect(classifyMediaFile(file('intro.mp4', 'video/mp4'))).toEqual({ kind: 'video', ext: 'mp4' })
    expect(classifyMediaFile(file('intro.webm', 'video/webm'))).toEqual({ kind: 'video', ext: 'webm' })
  })

  it('falls back to the file extension and normalises jpeg', () => {
    expect(classifyMediaFile(file('shot.JPEG', 'application/octet-stream'))).toEqual({ kind: 'image', ext: 'jpg' })
    expect(classifyMediaFile(file('clip.MP4', 'application/octet-stream'))).toEqual({ kind: 'video', ext: 'mp4' })
  })

  it('rejects unsupported files', () => {
    expect(classifyMediaFile(file('notes.txt', 'text/plain'))).toBeNull()
    expect(classifyMediaFile(file('data.bin', 'application/octet-stream'))).toBeNull()
    expect(classifyMediaFile(file('no-extension', 'application/octet-stream'))).toBeNull()
    expect(classifyMediaFile(file('doc.pdf', 'application/pdf'))).toBeNull()
  })
})

describe('palette derivation', () => {
  it('builds a dark theme from a dark average color', () => {
    const palette = buildMediaPalette({ r: 18, g: 24, b: 64 })
    expect(palette.dark).toBe(true)
    expect(palette.accent).toMatch(/^#[0-9a-f]{6}$/)
    expect(palette.glow).toMatch(/^rgba\(\d+,\d+,\d+,0\.45\)$/)
    for (const key of ['bg', 'surface', 'surface2', 'fg', 'fgMuted', 'border', 'codeBg', 'accentFg', 'particle2']) {
      expect(palette[key as keyof typeof palette]).toEqual(expect.any(String))
    }
  })

  it('builds a light theme from a light average color', () => {
    const palette = buildMediaPalette({ r: 246, g: 244, b: 238 })
    expect(palette.dark).toBe(false)
  })

  it('builds the full desktop + upstream token set', () => {
    const variables = buildMediaVariables(buildMediaPalette({ r: 40, g: 120, b: 200 }))
    expect(variables['--dsh-desktop-accent']).toBeDefined()
    expect(variables['--dsh-desktop-bg']).toBeDefined()
    expect(variables['--dsw-alias-bg-base']).toBe(variables['--dsh-desktop-bg'])
    expect(variables['--dsw-alias-accent']).toBe(variables['--dsh-desktop-accent'])
  })

  it('mixes and converts colors deterministically', () => {
    expect(rgbToHex({ r: 255, g: 0, b: 128 })).toBe('#ff0080')
    expect(mixRgb({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, 0.5)).toEqual({ r: 127.5, g: 127.5, b: 127.5 })
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0)
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 2)
  })
})

describe('imported media lifecycle helpers', () => {
  const mediaSkin: Skin = {
    id: 'media-abc123',
    label: 'x',
    description: 'x',
    variables: {},
    custom: true,
    ambient: {
      particle: '#fff',
      glow: 'rgba(0,0,0,0.5)',
      density: 36,
      shape: 'bubble',
      speed: 0.45,
      mascot: false,
      bgImage: '/desktop/skins/user-imports/media-abc123.jpg',
      video: '/desktop/skins/user-imports/media-abc123.mp4',
    },
  }

  it('extracts user-import media ids from ambient URLs', () => {
    expect(importedMediaIds(mediaSkin)).toEqual(['media-abc123'])
    const withoutAmbient: Skin = { ...mediaSkin }
    delete withoutAmbient.ambient
    expect(importedMediaIds(withoutAmbient)).toEqual([])
    const builtinOnly: Skin = {
      ...mediaSkin,
      ambient: {
        particle: '#fff',
        glow: 'rgba(0,0,0,0.5)',
        density: 36,
        shape: 'bubble',
        speed: 0.45,
        mascot: false,
        bgImage: '/desktop/skins/bg/fused-v3/whale-dawn.png',
      },
    }
    expect(importedMediaIds(builtinOnly)).toEqual([])
  })

  it('asks the host to delete referenced media', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/desktop/skins/media?id=media-abc123')
      expect(init?.method).toBe('DELETE')
      return new Response(JSON.stringify({ ok: true, removed: 2 }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    await deleteImportedMedia(mediaSkin)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('uploadMedia', () => {
  it('posts the blob and resolves the served url', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain('/desktop/skins/media?id=media-up1&ext=png')
      expect(init?.method).toBe('POST')
      expect(init?.body).toBeInstanceOf(Blob)
      return new Response(JSON.stringify({ ok: true, url: '/desktop/skins/user-imports/media-up1.png' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const url = await uploadMedia(file('a.png', 'image/png'), 'media-up1', 'png')
    expect(url).toBe('/desktop/skins/user-imports/media-up1.png')
  })

  it('surfaces the host error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ ok: false, error: 'unsupported media type' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )))
    await expect(uploadMedia(file('a.exe', 'application/x'), 'media-up2', 'exe')).rejects.toThrow('unsupported media type')
  })
})

describe('importMediaSkin', () => {
  it('rejects unsupported files with a user-facing message', async () => {
    await expect(importMediaSkin(file('notes.txt', 'text/plain'))).rejects.toThrow('不支持的文件类型')
  })
})

describe('parseImportedSkin particles flag', () => {
  it('keeps the particle stream on by default', () => {
    const skin = parseImportedSkin({
      label: '默认粒子',
      variables: { '--dsh-desktop-bg': '#101010' },
      ambient: { particle: '#fff', glow: 'rgba(0,0,0,0.5)', density: 40, shape: 'bubble', speed: 0.5, mascot: false },
    })
    expect(skin?.ambient?.particles).toBeUndefined()
  })

  it('honours particles: false from an imported JSON skin', () => {
    const skin = parseImportedSkin({
      label: '无粒子',
      variables: { '--dsh-desktop-bg': '#101010' },
      ambient: {
        particle: '#fff', glow: 'rgba(0,0,0,0.5)', density: 40,
        shape: 'bubble', speed: 0.5, mascot: false, particles: false,
      },
    })
    expect(skin?.ambient?.particles).toBe(false)
  })

  it('serialises the particles flag back out on export', async () => {
    const { exportCustomSkin } = await import('../src/client/features/skins/skin-service.ts')
    const skin = parseImportedSkin({
      label: '无粒子',
      variables: { '--dsh-desktop-bg': '#101010' },
      ambient: {
        particle: '#fff', glow: 'rgba(0,0,0,0.5)', density: 40,
        shape: 'bubble', speed: 0.5, mascot: false, particles: false,
      },
    })
    expect(skin).not.toBeNull()
    const exported = JSON.parse(exportCustomSkin(skin!)) as { ambient?: { particles?: unknown } }
    expect(exported.ambient?.particles).toBe(false)
  })
})
