/**
 * Client-side "import media → generate skin" helpers.
 *
 * The sandboxed renderer cannot write to disk, so uploaded media is streamed to
 * the Host through the `/desktop/skins/media` loopback route (see
 * `skins-host.ts`); the returned origin-relative URL is stored inside the skin's
 * `ambient` config, exactly like the built-in whale-skin assets.
 *
 * Static images (jpg / png / webp) become still-background skins, animated GIFs
 * are treated as images (the ambient canvas redraws the animated frame every
 * tick), and videos (mp4 / webm) become full-screen looping video skins with a
 * JPEG first-frame poster. A color palette is sampled from the media so the
 * skin's CSS tokens (background / text / accent) match the artwork without the
 * user touching JSON.
 */

import type { Skin, WhaleAmbient } from './skins.ts'

/** Static image types the importer accepts (extensions, no dot). */
export const IMPORT_IMAGE_EXTS: ReadonlySet<string> = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])
/** Animated / video types the importer accepts (extensions, no dot). */
export const IMPORT_VIDEO_EXTS: ReadonlySet<string> = new Set(['mp4', 'webm'])

export type ImportMediaKind = 'image' | 'video'

export interface ClassifiedMedia {
  kind: ImportMediaKind
  /** Canonical extension (jpeg normalised to jpg) without the dot. */
  ext: string
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

/** Classify a picked file into an importable media kind, or null when unsupported. */
export function classifyMediaFile(file: File): ClassifiedMedia | null {
  const byMime = MIME_TO_EXT[file.type.toLowerCase()]
  const ext = byMime ?? extFromName(file.name)
  if (ext === null) return null
  const canonical = ext === 'jpeg' ? 'jpg' : ext
  if (IMPORT_IMAGE_EXTS.has(canonical)) return { kind: 'image', ext: canonical }
  if (IMPORT_VIDEO_EXTS.has(canonical)) return { kind: 'video', ext: canonical }
  return null
}

function extFromName(name: string): string | null {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return null
  const ext = name.slice(dot + 1).toLowerCase()
  if (ext.length === 0 || ext.length > 5) return null
  return ext
}

/** Media ids referenced by a skin's ambient (user-imported assets only). */
export function importedMediaIds(skin: Skin): string[] {
  const urls: string[] = []
  const ambient = skin.ambient
  if (ambient !== undefined) {
    if (ambient.bgImage !== undefined) urls.push(ambient.bgImage)
    if (ambient.bgVideo !== undefined) urls.push(ambient.bgVideo)
    if (ambient.video !== undefined) urls.push(ambient.video)
    if (ambient.charImage !== undefined) urls.push(ambient.charImage)
    for (const frame of ambient.charFrames ?? []) urls.push(frame)
  }
  const ids = new Set<string>()
  for (const url of urls) {
    const match = /^\/desktop\/skins\/user-imports\/(media-[a-z0-9-]+)\./i.exec(url)
    if (match !== null) ids.add(match[1]!)
  }
  return [...ids]
}

/** Ask the Host to delete every user-imported media file referenced by a skin. */
export async function deleteImportedMedia(skin: Skin): Promise<void> {
  const ids = importedMediaIds(skin)
  await Promise.all(ids.map(async id => {
    try {
      await fetch(`/desktop/skins/media?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    } catch {
      // best-effort: an orphaned file on disk is harmless
    }
  }))
}

/** POST one blob to the Host media route; resolves with the served URL. */
export async function uploadMedia(blob: Blob, id: string, ext: string): Promise<string> {
  const response = await fetch(
    `/desktop/skins/media?id=${encodeURIComponent(id)}&ext=${encodeURIComponent(ext)}`,
    {
      method: 'POST',
      headers: { 'content-type': blob.type.length > 0 ? blob.type : 'application/octet-stream' },
      body: blob,
    },
  )
  let data: { ok?: unknown; url?: unknown; error?: unknown } | null = null
  try {
    data = await response.json() as { ok?: unknown; url?: unknown; error?: unknown }
  } catch {
    // non-JSON error body
  }
  if (!response.ok || data === null || data.ok !== true || typeof data.url !== 'string') {
    const message = data !== null && typeof data.error === 'string' ? data.error : `上传失败 (HTTP ${String(response.status)})`
    throw new Error(message)
  }
  return data.url
}

// ---- color sampling / palette derivation (pure helpers, unit-tested) ----

interface Rgb {
  r: number
  g: number
  b: number
}

export interface MediaPalette {
  accent: string
  bg: string
  surface: string
  surface2: string
  fg: string
  fgMuted: string
  border: string
  codeBg: string
  accentFg: string
  glow: string
  particle2: string
  dark: boolean
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t))
  return { r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k }
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  const chan = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
}

/** Average color of a canvas / image / video frame, sampled down to 48×48. */
export function sampleAverageColor(source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement): Rgb {
  const canvas = document.createElement('canvas')
  const size = 48
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx === null) return { r: 31, g: 42, b: 68 }
  ctx.drawImage(source, 0, 0, size, size)
  const data = ctx.getImageData(0, 0, size, size).data
  let r = 0
  let g = 0
  let b = 0
  let count = 0
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] ?? 0
    if (alpha < 40) continue
    r += data[i] ?? 0
    g += data[i + 1] ?? 0
    b += data[i + 2] ?? 0
    count += 1
  }
  if (count === 0) return { r: 31, g: 42, b: 68 }
  return { r: r / count, g: g / count, b: b / count }
}

const BLACK: Rgb = { r: 8, g: 12, b: 24 }
const WHITE: Rgb = { r: 255, g: 255, b: 255 }

/** Derive a full skin token palette from the media's average color. */
export function buildMediaPalette(source: Rgb): MediaPalette {
  const lum = relativeLuminance(source)
  const dark = lum < 0.45
  // Nudge the accent toward visibility on the derived background.
  const accentRgb = dark ? mixRgb(source, WHITE, 0.26) : mixRgb(source, BLACK, 0.16)
  const accent = rgbToHex(accentRgb)
  const accentLum = relativeLuminance(accentRgb)
  if (dark) {
    return {
      accent,
      bg: rgbToHex(mixRgb(accentRgb, BLACK, 0.8)),
      surface: rgbToHex(mixRgb(accentRgb, BLACK, 0.72)),
      surface2: rgbToHex(mixRgb(accentRgb, BLACK, 0.62)),
      fg: rgbToHex(mixRgb(WHITE, accentRgb, 0.08)),
      fgMuted: rgbToHex(mixRgb(WHITE, accentRgb, 0.52)),
      border: rgbToHex(mixRgb(accentRgb, BLACK, 0.55)),
      codeBg: rgbToHex(mixRgb(accentRgb, BLACK, 0.86)),
      accentFg: accentLum > 0.55 ? '#101622' : '#ffffff',
      glow: `rgba(${Math.round(accentRgb.r)},${Math.round(accentRgb.g)},${Math.round(accentRgb.b)},0.45)`,
      particle2: rgbToHex(mixRgb(accentRgb, WHITE, 0.38)),
      dark,
    }
  }
  return {
    accent,
    bg: rgbToHex(mixRgb(accentRgb, WHITE, 0.88)),
    surface: rgbToHex(mixRgb(accentRgb, WHITE, 0.96)),
    surface2: rgbToHex(mixRgb(accentRgb, WHITE, 0.8)),
    fg: rgbToHex(mixRgb(BLACK, accentRgb, 0.28)),
    fgMuted: rgbToHex(mixRgb(BLACK, accentRgb, 0.55)),
    border: rgbToHex(mixRgb(accentRgb, WHITE, 0.74)),
    codeBg: rgbToHex(mixRgb(accentRgb, WHITE, 0.92)),
    accentFg: accentLum > 0.55 ? '#101622' : '#ffffff',
    glow: `rgba(${Math.round(accentRgb.r)},${Math.round(accentRgb.g)},${Math.round(accentRgb.b)},0.45)`,
    particle2: rgbToHex(mixRgb(accentRgb, WHITE, 0.42)),
    dark,
  }
}

/** Same token set as the manual skin creator, derived from a media palette. */
export function buildMediaVariables(palette: MediaPalette): Record<string, string> {
  return {
    '--dsh-desktop-bg': palette.bg,
    '--dsh-desktop-surface': palette.surface,
    '--dsh-desktop-surface-2': palette.surface2,
    '--dsh-desktop-fg': palette.fg,
    '--dsh-desktop-fg-muted': palette.fgMuted,
    '--dsh-desktop-border': palette.border,
    '--dsh-desktop-accent': palette.accent,
    '--dsh-desktop-accent-fg': palette.accentFg,
    '--dsh-desktop-code-bg': palette.codeBg,
    '--dsw-alias-bg-base': palette.bg,
    '--dsw-alias-bg-elevated': palette.surface,
    '--dsw-alias-fg-base': palette.fg,
    '--dsw-alias-fg-muted': palette.fgMuted,
    '--dsw-alias-border-l1': palette.border,
    '--dsw-alias-border-l2': palette.border,
    '--dsw-alias-accent': palette.accent,
  }
}

// ---- media → skin orchestration (DOM-requiring) ----

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => { resolve(img) }
    img.onerror = () => { reject(new Error('无法读取该图片。')) }
    img.src = url
  })
}

interface VideoCapture {
  posterBlob: Blob
  posterCanvas: HTMLCanvasElement
}

/** Options controlling how an imported media file becomes a skin. */
export interface ImportMediaOptions {
  /**
   * Whether the generated skin runs the floating particle field (颜色取自图片
   * 主色调). Defaults to true; pass false for a clean backdrop with no
   * particle stream.
   */
  particles?: boolean
}

/** Grab a JPEG first-frame poster + drawable canvas from a local video file. */
async function captureVideoPoster(file: File): Promise<VideoCapture> {
  const url = URL.createObjectURL(file)
  try {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = url
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => { resolve() }
      video.onerror = () => { reject(new Error('无法读取该视频。')) }
    })
    const duration = typeof video.duration === 'number' && isFinite(video.duration) ? video.duration : 1
    const seekTo = Math.min(0.15, duration / 2)
    if (seekTo > 0) {
      video.currentTime = seekTo
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => { resolve() }
        video.onerror = () => { reject(new Error('无法读取该视频。')) }
      })
    }
    const width = video.videoWidth > 0 ? video.videoWidth : 1280
    const height = video.videoHeight > 0 ? video.videoHeight : 720
    const scale = Math.min(1, 1280 / width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('无法处理该视频。')
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const posterBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob !== null) resolve(blob)
        else reject(new Error('无法生成视频封面。'))
      }, 'image/jpeg', 0.82)
    })
    return { posterBlob, posterCanvas: canvas }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Turn a user-picked image / animated image / video file into a ready-to-save
 * `Skin`: uploads the media to the Host, samples a matching color palette,
 * and wires the ambient background so the desktop renders it as a static or
 * dynamic skin. Throws a user-facing message on any unsupported or failed input.
 */
export async function importMediaSkin(file: File, options: ImportMediaOptions = {}): Promise<Skin> {
  const classified = classifyMediaFile(file)
  if (classified === null) {
    throw new Error('不支持的文件类型，请选择 jpg / png / webp / gif 图片或 mp4 / webm 视频。')
  }
  const { kind, ext } = classified
  const id = `media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const url = await uploadMedia(file, id, ext)

  let palette: MediaPalette
  let ambient: WhaleAmbient
  if (kind === 'video') {
    const capture = await captureVideoPoster(file)
    const posterUrl = await uploadMedia(capture.posterBlob, id, 'jpg')
    palette = buildMediaPalette(sampleAverageColor(capture.posterCanvas))
    ambient = {
      particle: palette.accent,
      particle2: palette.particle2,
      glow: palette.glow,
      density: 36,
      shape: 'bubble',
      speed: 0.45,
      mascot: false,
      video: url,
      bgImage: posterUrl,
    }
  } else {
    const img = await loadImage(url)
    palette = buildMediaPalette(sampleAverageColor(img))
    ambient = {
      particle: palette.accent,
      particle2: palette.particle2,
      glow: palette.glow,
      density: 36,
      shape: 'bubble',
      speed: 0.45,
      mascot: false,
      bgImage: url,
    }
  }
  // 粒子流开关：关闭时生成干净的静态 / 动态背景（粒子颜色仍取自主色调）。
  if (options.particles === false) ambient.particles = false

  const baseName = file.name.replace(/\.[^.]+$/, '').trim()
  const label = baseName.length > 0
    ? (baseName.length > 24 ? `${baseName.slice(0, 24)}…` : baseName)
    : '我的皮肤'
  return {
    id,
    label,
    description: kind === 'video' ? '从上传的视频自动生成的动态皮肤。' : '从上传的图片自动生成的静态皮肤。',
    variables: buildMediaVariables(palette),
    ambient,
    custom: true,
  }
}
