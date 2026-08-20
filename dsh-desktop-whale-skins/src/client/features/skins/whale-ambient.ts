import { getSkin, getSkinById, subscribeSkin } from './skin-service.ts'
import type { WhaleAmbient } from './skins.ts'

/**
 * Themed "stage" engine for atmospheric (鲸鱼娘 / whale-girl) skins.
 *
 * Two rendering paths are supported:
 *
 * 1. Fused animated video (preferred): when `ambient.video` is set and the user
 *    has not requested reduced motion, a single full-screen `<video>` plays a
 *    seamless loop where the whale-girl is already part of the scene. The
 *    character, the environment, and ambient motion (snow, rain, bubbles,
 *    petals, aurora, stars…) all live in one coherent clip, so the result is
 *    naturally fused rather than layered.
 *
 * 2. Canvas fallback: when no video is supplied, or when reduced motion is
 *    preferred, the classic three-canvas stack renders a static/dynamic scene
 *    (backdrop image + optional transparent character cutout + procedural
 *    particles).
 *
 * Surfaces turn fully transparent (see styles.ts `[data-skin][data-whale-bg]`)
 * so the artwork shows through.
 */

const MOUSE_RADIUS = 240
const REDUCED = typeof globalThis.matchMedia === 'function'
  && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches

interface Particle {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  /** 0..1 tint along the particle → particle2 gradient. */
  t: number
  /** Phase offset for wobble / twinkle. */
  phase: number
  /** Current opacity. */
  alpha: number
}

interface BgItem {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  ph: number
  tw: number
  sp: number
  sw: number
  len: number
  life: number
  hue: number
  rot: number
  vr: number
}

interface BokehItem {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  alpha: number
  hue: number
  phase: number
}

type Rgb = [number, number, number]

function toRgb(input: string): Rgb | null {
  const s = input.trim()
  if (s.startsWith('#')) {
    let h = s.slice(1)
    if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!
    if (h.length === 6) {
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
    }
    return null
  }
  const m = s.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const p = m[1]!.split(',').map(n => parseFloat(n))
    return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0]
  }
  return null
}

/** Build a soft radial glow sprite tinted with `color`. */
function makeGlowSprite(color: Rgb, size = 64): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const [r, gr, b] = color
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, `rgba(${r},${gr},${b},1)`)
  grad.addColorStop(0.35, `rgba(${r},${gr},${b},0.55)`)
  grad.addColorStop(1, `rgba(${r},${gr},${b},0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  return c
}

function rnd(a: number, b: number): number { return a + Math.random() * (b - a) }

function makeCanvas(className: string, z: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.className = className
  c.setAttribute('aria-hidden', 'true')
  c.style.position = 'fixed'
  c.style.inset = '0'
  c.style.width = '100%'
  c.style.height = '100%'
  c.style.zIndex = String(z)
  c.style.pointerEvents = 'none'
  c.style.display = 'none'
  return c
}

function makeVideo(): HTMLVideoElement {
  const v = document.createElement('video')
  v.className = 'dshDesktopWhaleBg'
  v.setAttribute('aria-hidden', 'true')
  v.style.position = 'fixed'
  v.style.inset = '0'
  v.style.width = '100%'
  v.style.height = '100%'
  v.style.zIndex = '-3'
  v.style.objectFit = 'cover'
  v.style.pointerEvents = 'none'
  v.style.display = 'none'
  v.muted = true
  v.loop = true
  v.setAttribute('playsinline', 'true')
  v.setAttribute('preload', 'auto')
  return v
}

class WhaleAmbientEngine {
  private readonly bgCanvas: HTMLCanvasElement
  private readonly charCanvas: HTMLCanvasElement
  private readonly fxCanvas: HTMLCanvasElement
  private readonly bgx: CanvasRenderingContext2D
  private readonly charx: CanvasRenderingContext2D
  private readonly fxx: CanvasRenderingContext2D

  private readonly videoEl: HTMLVideoElement

  private particles: Particle[] = []
  private raf = 0
  private w = 0
  private h = 0
  private dpr = 1
  private running = false
  private listenersBound = false
  private config: WhaleAmbient | null = null

  private sprites: HTMLCanvasElement[] = []
  private auraSprite: HTMLCanvasElement | null = null
  private time = 0

  private readonly mouse = { x: -9999, y: -9999, active: false }
  private readonly aura = { x: -9999, y: -9999 }
  /** Tiny particles emitted while the mouse moves (cursor-dust trail). */
  private cursorDust: { x: number; y: number; vx: number; vy: number; r: number; t: number; life: number }[] = []
  private videoRaf = 0

  // --- background state ---
  private bgType: NonNullable<WhaleAmbient['dynamicBg']> | null = null
  private bgParts: BgItem[] = []
  private bokeh: BokehItem[] = []
  private bgImageEl: HTMLImageElement | null = null
  private bgImageReady = false

  // --- character state ---
  private charImg: HTMLImageElement | null = null
  private charReady = false
  private charAnim: NonNullable<WhaleAmbient['charAnim']> | null = null

  // --- dual-layer state (bgVideo + charFrames) ---
  private charFrames: HTMLImageElement[] = []
  private charFramesReady = false
  private charFrameIndex = 0
  private charFrameElapsed = 0
  private charFps = 8
  private spriteRaf = 0
  private spriteLastTs = 0

  private readonly onMove = (e: MouseEvent) => {
    this.mouse.x = e.clientX
    this.mouse.y = e.clientY
    this.mouse.active = true
    if (this.running && this.config && !REDUCED && this.config.particles !== false && this.cursorDust.length < 60) {
      this.cursorDust.push({
        x: e.clientX + rnd(-6, 6),
        y: e.clientY + rnd(-6, 6),
        vx: rnd(-0.5, 0.5),
        vy: rnd(-0.5, 0.5),
        r: rnd(0.5, 1.3),
        t: Math.random(),
        life: rnd(300, 700),
      })
    }
  }
  private readonly onLeave = () => { this.mouse.active = false }
  private readonly onResize = () => this.resize()
  private readonly onVisibility = () => {
    if (document.hidden) this.pause()
    else if (this.config) {
      if (!this.useVideo()) this.play()
      else {
        this.videoEl.play().catch(() => {})
        if (this.isDualLayer()) {
          this.spriteLastTs = 0
          cancelAnimationFrame(this.spriteRaf)
          this.spriteRaf = requestAnimationFrame(this.loopSprites)
        }
        if (this.config.particles !== false) {
          cancelAnimationFrame(this.videoRaf)
          this.videoRaf = requestAnimationFrame(this.loopVideoParticles)
        }
      }
    }
  }

  constructor() {
    this.bgCanvas = makeCanvas('dshDesktopWhaleBg', -2)
    this.charCanvas = makeCanvas('dshDesktopWhaleChar', -1)
    this.fxCanvas = makeCanvas('dshDesktopWhaleAmbient', 600)
    this.videoEl = makeVideo()
    document.body.append(this.videoEl, this.bgCanvas, this.charCanvas, this.fxCanvas)
    this.bgx = this.bgCanvas.getContext('2d')!
    this.charx = this.charCanvas.getContext('2d')!
    this.fxx = this.fxCanvas.getContext('2d')!
  }

  /** True when the current config wants the fused video path. */
  private useVideo(): boolean {
    const cfg = this.config
    if (!cfg) return false
    if (cfg.bgVideo && cfg.charFrames && cfg.charFrames.length > 0) return !REDUCED
    if (cfg.video) return !REDUCED
    return false
  }

  /** True when the engine is in dual-layer mode (bg video + sprite frames). */
  private isDualLayer(): boolean {
    const cfg = this.config
    return !!(cfg && cfg.bgVideo && cfg.charFrames && cfg.charFrames.length > 0)
  }

  activate(cfg: WhaleAmbient): void {
    this.config = cfg
    this.resize()

    if (this.useVideo()) {
      this.running = false
      this.pause()
      this.showVideo(cfg)
      return
    }

    this.hideVideo()
    this.showCanvases()
    this.setupCanvas(cfg)

    if (this.running) return
    this.running = true
    if (REDUCED) this.renderStatic()
    else this.play()
  }

  deactivate(): void {
    this.config = null
    this.running = false
    this.pause()
    cancelAnimationFrame(this.spriteRaf)
    cancelAnimationFrame(this.videoRaf)
    this.videoRaf = 0
    delete document.documentElement.dataset.whaleBg
    this.hideVideo()
    this.hideCanvases()
    this.bgx.clearRect(0, 0, this.w, this.h)
    this.charx.clearRect(0, 0, this.w, this.h)
    this.fxx.clearRect(0, 0, this.w, this.h)
    this.particles = []
    this.cursorDust = []
    this.bgParts = []
    this.bokeh = []
    this.bgType = null
    this.bgImageEl = null
    this.charImg = null
    this.charAnim = null
    this.charFrames = []
    this.charFramesReady = false
    this.charFrameIndex = 0
    this.charFrameElapsed = 0
    this.sprites = []
    this.auraSprite = null
  }

  dispose(): void {
    this.deactivate()
    this.videoEl.remove()
    this.bgCanvas.remove()
    this.charCanvas.remove()
    this.fxCanvas.remove()
    globalThis.removeEventListener('mousemove', this.onMove)
    globalThis.removeEventListener('mouseout', this.onLeave)
    globalThis.removeEventListener('resize', this.onResize)
    document.removeEventListener('visibilitychange', this.onVisibility)
  }

  private showVideo(cfg: WhaleAmbient): void {
    this.hideCanvases()
    this.videoEl.poster = cfg.bgImage ?? ''
    const particles = cfg.particles !== false
    if (particles) {
      // Particles stay alive on top of any video: floating field + cursor convergence.
      this.initSprites(cfg)
      this.seed()
      this.fxCanvas.style.display = 'block'
    } else {
      // Clean video backdrop: no particle field, cursor dust, or bokeh.
      this.particles = []
      this.bokeh = []
      this.fxCanvas.style.display = 'none'
    }
    this.bindListeners()
    this.running = true
    cancelAnimationFrame(this.videoRaf)
    if (particles) this.videoRaf = requestAnimationFrame(this.loopVideoParticles)
    if (cfg.bgVideo && cfg.charFrames && cfg.charFrames.length > 0) {
      // Dual-layer: background video keeps playing while transparent sprite frames
      // animate on top, so the environment keeps moving independently of the
      // character. This is the mature live2d / video-background pattern.
      this.videoEl.src = cfg.bgVideo
      this.videoEl.load()
      this.videoEl.style.display = 'block'
      this.charCanvas.style.display = 'block'
      document.documentElement.dataset.whaleBg = '1'
      const attempt = () => { this.videoEl.play().catch(() => {}) }
      attempt()
      this.videoEl.oncanplay = attempt
      this.loadCharFrames(cfg.charFrames, cfg.charFps ?? 8)
      this.spriteLastTs = 0
      cancelAnimationFrame(this.spriteRaf)
      this.spriteRaf = requestAnimationFrame(this.loopSprites)
      return
    }
    this.videoEl.src = cfg.video!
    this.videoEl.load()
    this.videoEl.style.display = 'block'
    document.documentElement.dataset.whaleBg = '1'
    const attempt = () => { this.videoEl.play().catch(() => {}) }
    attempt()
    this.videoEl.oncanplay = attempt
  }

  private hideVideo(): void {
    this.videoEl.pause()
    this.videoEl.style.display = 'none'
    this.videoEl.oncanplay = null
    this.videoEl.removeAttribute('src')
    this.videoEl.load()
  }

  private showCanvases(): void {
    this.bgCanvas.style.display = 'block'
    this.charCanvas.style.display = 'block'
    this.fxCanvas.style.display = 'block'
  }

  private hideCanvases(): void {
    this.bgCanvas.style.display = 'none'
    this.charCanvas.style.display = 'none'
    this.fxCanvas.style.display = 'none'
  }

  /** Build the particle/aura glow sprites from the theme colors. */
  private initSprites(cfg: WhaleAmbient): void {
    const c1 = toRgb(cfg.particle) ?? [95, 227, 255]
    const c2 = cfg.particle2 ? (toRgb(cfg.particle2) ?? c1) : c1
    const steps = 8
    this.sprites = Array.from({ length: steps }, (_, i) => {
      const t = i / (steps - 1)
      const mix: Rgb = [
        Math.round(c1[0] + (c2[0] - c1[0]) * t),
        Math.round(c1[1] + (c2[1] - c1[1]) * t),
        Math.round(c1[2] + (c2[2] - c1[2]) * t),
      ]
      return makeGlowSprite(mix)
    })
    const glow = toRgb(cfg.glow) ?? c1
    this.auraSprite = makeGlowSprite(glow, 128)
  }

  private setupCanvas(cfg: WhaleAmbient): void {
    this.initSprites(cfg)

    // --- scene backdrop image ---
    this.bgImageEl = null
    this.bgImageReady = false
    if (cfg.bgImage) {
      const img = new Image()
      img.onload = () => { this.bgImageReady = true }
      img.onerror = () => { this.bgImageReady = false }
      img.src = cfg.bgImage
      this.bgImageEl = img
    }

    // --- character cutout ---
    this.charImg = null
    this.charReady = false
    this.charAnim = cfg.charAnim ?? null
    if (cfg.charImage) {
      const img = new Image()
      img.onload = () => { this.charReady = true }
      img.onerror = () => { this.charReady = false }
      img.src = cfg.charImage
      this.charImg = img
    }

    // --- dynamic overlay ---
    this.bgType = cfg.dynamicBg ?? null

    document.documentElement.dataset.whaleBg = '1'
    if (cfg.particles !== false) {
      this.seed()
      this.seedBokeh()
    } else {
      this.particles = []
      this.bokeh = []
    }
    this.seedBG()
  }

  private bindListeners(): void {
    if (this.listenersBound) return
    globalThis.addEventListener('mousemove', this.onMove)
    globalThis.addEventListener('mouseout', this.onLeave)
    globalThis.addEventListener('resize', this.onResize)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.listenersBound = true
  }

  private play(): void {
    this.bindListeners()
    this.loop()
  }

  private pause(): void {
    cancelAnimationFrame(this.raf)
    cancelAnimationFrame(this.videoRaf)
  }

  private resize(): void {
    this.w = globalThis.innerWidth
    this.h = globalThis.innerHeight
    this.dpr = Math.min(globalThis.devicePixelRatio || 1, 2)
    for (const c of [this.bgCanvas, this.charCanvas, this.fxCanvas]) {
      c.width = Math.floor(this.w * this.dpr)
      c.height = Math.floor(this.h * this.dpr)
      c.style.width = `${this.w}px`
      c.style.height = `${this.h}px`
    }
    this.bgx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.charx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.fxx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    if (this.config) {
      const particles = this.config.particles !== false
      if (this.useVideo()) {
        // video path: keep the particle field spread across the new viewport
        if (particles) this.seed()
      } else {
        if (particles) this.seed()
        this.seedBG()
        if (particles) this.seedBokeh()
        if (REDUCED) this.renderStatic()
      }
    }
  }

  private targetCount(): number {
    const cfg = this.config!
    const base = (this.w * this.h) / (1280 * 720)
    return Math.max(24, Math.min(360, Math.round(cfg.density * base)))
  }

  private seed(): void {
    const n = this.targetCount()
    const out: Particle[] = []
    for (let i = 0; i < n; i++) {
      const r = 0.4 + Math.random() * 0.8
      out.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        r,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        t: Math.random(),
        phase: Math.random() * Math.PI * 2,
        alpha: 0.35 + Math.random() * 0.5,
      })
    }
    this.particles = out
  }

  private seedBG(): void {
    const type = this.bgType
    this.bgParts = []
    if (!type) return
    const N = type === 'starfield' ? 220
      : type === 'snow' ? 260
      : type === 'rain' ? 420
      : type === 'cyber' ? 0
      : 200
    for (let i = 0; i < N; i++) {
      if (type === 'starfield') this.bgParts.push({ x: rnd(0, this.w), y: rnd(0, this.h), r: rnd(0.4, 1.8), vx: 0, vy: 0, ph: 0, tw: rnd(0, 6.28), sp: rnd(0.6, 2), sw: 0, len: 0, life: 0, hue: 0, rot: 0, vr: 0 })
      else if (type === 'snow') this.bgParts.push({ x: rnd(0, this.w), y: rnd(0, this.h), r: rnd(1, 3.8), vx: rnd(-0.3, 0.3), vy: rnd(0.4, 1.4), ph: 0, tw: 0, sp: 0, sw: rnd(0, 6.28), len: 0, life: 0, hue: 0, rot: 0, vr: 0 })
      else if (type === 'rain') this.bgParts.push({ x: rnd(0, this.w), y: rnd(0, this.h), r: 0, vx: -3, vy: rnd(9, 16), ph: 0, tw: 0, sp: 0, sw: 0, len: rnd(10, 26), life: 0, hue: 0, rot: 0, vr: 0 })
      else if (type === 'fire') this.bgParts.push({ x: rnd(0, this.w), y: rnd(this.h * 0.55, this.h), r: rnd(6, 20), vx: 0, vy: rnd(-1.6, -0.6), ph: 0, tw: 0, sp: 0, sw: 0, len: 0, life: rnd(0, 1), hue: rnd(0, 1), rot: 0, vr: 0 })
      else if (type === 'bubbles') this.bgParts.push({ x: rnd(0, this.w), y: rnd(0, this.h), r: rnd(3, 12), vx: 0, vy: rnd(-0.8, -0.25), ph: rnd(0, 6.28), tw: 0, sp: 0, sw: 0, len: 0, life: 0, hue: 0, rot: 0, vr: 0 })
      else if (type === 'sakura') this.bgParts.push({ x: rnd(0, this.w), y: rnd(0, this.h), r: rnd(4, 9), vx: rnd(-0.4, 0.6), vy: rnd(0.5, 1.4), ph: 0, tw: 0, sp: 0, sw: 0, len: 0, life: 0, hue: 0, rot: rnd(0, 6.28), vr: rnd(-0.04, 0.04) })
      else if (type === 'cyber') this.bgParts.push({ x: 0, y: 0, r: 0, vx: 0, vy: 0, ph: 0, tw: 0, sp: 0, sw: 0, len: 0, life: 0, hue: 0, rot: 0, vr: 0 })
      else this.bgParts.push({ x: rnd(0, this.w), y: rnd(0, this.h), r: rnd(1, 3), vx: rnd(-0.2, 0.2), vy: rnd(0.2, 0.7), ph: rnd(0, 6.28), tw: 0, sp: 0, sw: 0, len: 0, life: 0, hue: 0, rot: 0, vr: 0 })
    }
  }

  private seedBokeh(): void {
    const cfg = this.config!
    const c1 = toRgb(cfg.particle) ?? [95, 227, 255]
    const c2 = cfg.particle2 ? (toRgb(cfg.particle2) ?? c1) : c1
    const baseHue = Math.atan2(c1[1] - c2[1], c1[0] - c2[0])
    this.bokeh = []
    const count = Math.min(40, Math.max(16, Math.floor((this.w * this.h) / 90000)))
    for (let i = 0; i < count; i++) {
      this.bokeh.push({
        x: rnd(0, this.w),
        y: rnd(0, this.h),
        r: rnd(20, 110),
        vx: rnd(-0.15, 0.15),
        vy: rnd(-0.1, 0.1),
        alpha: rnd(0.04, 0.14),
        hue: baseHue + rnd(-0.3, 0.3),
        phase: rnd(0, 6.28),
      })
    }
  }

  private renderStatic(): void {
    const cfg = this.config
    this.drawBG(0)
    // When a fused video is provided but we're in static/canvas fallback
    // (reduced motion or no video support), draw only the fused still image so
    // the scene stays coherent and un-layered.
    if (cfg?.video) return
    this.drawCharacter(0, false)
    this.drawOverlay(0)
    if (cfg?.particles !== false) this.drawParticles(true)
  }

  private loop = (): void => {
    if (!this.running || this.config === null) return
    this.time += 1
    const t = this.time
    this.drawBG(t)
    this.drawCharacter(t, true)
    this.drawOverlay(t)
    if (this.config.particles !== false) this.drawParticles(false)
    this.raf = requestAnimationFrame(this.loop)
  }

  /* ============ background layer (scene backdrop) ============ */
  private drawBG(_t: number): void {
    const ctx = this.bgx
    ctx.clearRect(0, 0, this.w, this.h)

    if (this.bgImageEl && this.bgImageReady) {
      const ir = this.bgImageEl.width / this.bgImageEl.height
      const sr = this.w / this.h
      let dw: number, dh: number, dx: number, dy: number
      if (ir > sr) { dh = this.h; dw = dh * ir; dx = (this.w - dw) / 2; dy = 0 }
      else { dw = this.w; dh = dw / ir; dx = 0; dy = (this.h - dh) / 2 }
      ctx.drawImage(this.bgImageEl, dx, dy, dw, dh)
      const v = ctx.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.35, this.w / 2, this.h / 2, this.h * 0.85)
      v.addColorStop(0, 'rgba(0,0,0,0)')
      v.addColorStop(1, 'rgba(0,0,0,0.35)')
      ctx.fillStyle = v
      ctx.fillRect(0, 0, this.w, this.h)
      return
    }

    const type = this.bgType
    if (!type) return

    const accent = this.config!.particle
    const grad = ctx.createLinearGradient(0, 0, 0, this.h)
    if (type === 'water') { grad.addColorStop(0, '#0a2a44'); grad.addColorStop(1, '#04101c') }
    else if (type === 'aurora') { grad.addColorStop(0, '#0a1430'); grad.addColorStop(1, '#070a1c') }
    else if (type === 'sunrise') { grad.addColorStop(0, '#ffd9b0'); grad.addColorStop(0.5, '#ffb38a'); grad.addColorStop(1, '#7fa9c9') }
    else if (type === 'starfield') { grad.addColorStop(0, '#05060f'); grad.addColorStop(1, '#0a0a1e') }
    else if (type === 'bubbles') { grad.addColorStop(0, '#dffaf2'); grad.addColorStop(1, '#a9ece0') }
    else if (type === 'snow') { grad.addColorStop(0, '#eaf3fc'); grad.addColorStop(1, '#cfe0f2') }
    else if (type === 'fire') { grad.addColorStop(0, '#2a0d06'); grad.addColorStop(1, '#0a0402') }
    else if (type === 'sakura') { grad.addColorStop(0, '#fff0f5'); grad.addColorStop(1, '#ffd9e6') }
    else if (type === 'cyber') { grad.addColorStop(0, '#04070d'); grad.addColorStop(1, '#020409') }
    else { grad.addColorStop(0, accent); grad.addColorStop(1, accent) }
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, this.w, this.h)
  }

  /* ============ character layer (transparent cutout or sprite frames) ============ */
  private drawCharacter(t: number, animate: boolean): void {
    const ctx = this.charx
    ctx.clearRect(0, 0, this.w, this.h)
    if (!this.charImg || !this.charReady) return

    const img = this.charImg
    const aspect = img.width / img.height
    const ch = this.h * 0.96
    const cw = ch * aspect
    const anchorX = this.w * 0.30
    const bottom = this.h * 0.995

    let rot = 0
    let sx = 1
    let sy = 1
    let dx = 0
    let dy = 0

    if (animate) {
      const s = t * 0.016 // pseudo-seconds
      switch (this.charAnim) {
        case 'breath': { const k = Math.sin(s * 1.2); dy = k * 4; const sc = 1 + 0.02 * k; sx = sc; sy = sc; break }
        case 'lookUp': { rot = Math.sin(s * 0.5) * 0.04; dy = Math.sin(s * 0.8) * 3; break }
        case 'nod': { const k = Math.sin(s * 1.5); dy = -Math.abs(k) * 6; rot = k * 0.03; break }
        case 'float': { dy = Math.sin(s * 0.9) * 10; rot = Math.sin(s * 0.5) * 0.05; break }
        case 'wave': { rot = Math.sin(s * 2.2) * 0.05; dx = Math.sin(s * 2.2) * 4; dy = Math.sin(s * 1.1) * 4; break }
        case 'twirl': { rot = Math.sin(s * 1.1) * 0.13; dy = Math.abs(Math.cos(s * 1.1)) * 4; break }
        case 'hairFlip': { rot = Math.sin(s * 0.9) * 0.05; dy = Math.sin(s * 0.7) * 4; break }
        case 'umbrella': { rot = Math.sin(s * 0.7) * 0.03 + Math.sin(s * 0.3) * 0.02; dy = Math.sin(s * 0.9) * 5; break }
        default: { dy = Math.sin(s * 0.8) * 4 }
      }
    }

    ctx.save()
    ctx.translate(anchorX + cw / 2 + dx, bottom + dy)
    ctx.rotate(rot)
    ctx.scale(sx, sy)
    ctx.drawImage(img, -cw / 2, -ch, cw, ch)
    ctx.restore()
  }

  /* ============ dual-layer sprite animation (bg video + transparent sprite frames) ============ */
  private loadCharFrames(urls: string[], fps: number): void {
    this.charFrames = []
    this.charFramesReady = false
    this.charFrameIndex = 0
    this.charFrameElapsed = 0
    this.charFps = fps
    let loaded = 0
    const total = urls.length
    if (total === 0) return
    for (const url of urls) {
      const img = new Image()
      img.onload = img.onerror = () => {
        loaded++
        if (loaded === total) {
          this.charFramesReady = true
          this.drawSpriteFrame()
        }
      }
      img.src = url
      this.charFrames.push(img)
    }
  }

  private loopSprites = (): void => {
    if (!this.isDualLayer()) return
    const now = performance.now()
    if (this.spriteLastTs === 0) this.spriteLastTs = now
    const dt = now - this.spriteLastTs
    this.spriteLastTs = now
    if (!document.hidden) {
      this.charFrameElapsed += dt
      const frameMs = 1000 / this.charFps
      // advance frames, but never more than one per tick to keep animation smooth
      if (this.charFrameElapsed >= frameMs && this.charFrames.length > 1) {
        this.charFrameElapsed = 0
        this.charFrameIndex = (this.charFrameIndex + 1) % this.charFrames.length
      }
      this.drawSpriteFrame()
    }
    this.spriteRaf = requestAnimationFrame(this.loopSprites)
  }

  /** Lightweight rAF loop used while a fused video plays: only the particle
   *  field runs (floating + cursor convergence) on top of the video. */
  private loopVideoParticles = (): void => {
    if (!this.running || !this.config || !this.useVideo() || this.config.particles === false) return
    this.time += 1
    this.drawParticles(false)
    this.videoRaf = requestAnimationFrame(this.loopVideoParticles)
  }

  /** Draw the current sprite frame on the character canvas with a soft contact
   *  shadow so the cutout feels grounded in the live scene. */
  private drawSpriteFrame(): void {
    const ctx = this.charx
    ctx.clearRect(0, 0, this.w, this.h)
    if (!this.charFramesReady || this.charFrames.length === 0) return
    const img = this.charFrames[this.charFrameIndex]
    if (!img || !img.complete || img.naturalWidth === 0) return

    const aspect = img.width / img.height
    const ch = this.h * 0.92
    const cw = ch * aspect
    const cx = this.w * 0.5
    const bottom = this.h * 0.98

    // soft contact shadow under the character
    ctx.save()
    const shadowR = cw * 0.22
    const sg = ctx.createRadialGradient(cx, bottom - 6, 0, cx, bottom - 6, shadowR)
    sg.addColorStop(0, 'rgba(0,0,0,0.32)')
    sg.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = sg
    ctx.beginPath()
    ctx.ellipse(cx, bottom - 6, shadowR, shadowR * 0.35, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // character sprite
    ctx.drawImage(img, cx - cw / 2, bottom - ch, cw, ch)
  }

  /* ============ dynamic overlay layer (theme motion + bokeh) ============ */
  private drawOverlay(t: number): void {
    const ctx = this.fxx
    const type = this.bgType
    ctx.clearRect(0, 0, this.w, this.h)

    if (!type) return

    const accent = this.config!.particle

    if (type === 'aurora') {
      for (let b = 0; b < 3; b++) {
        const yy = this.h * (0.25 + b * 0.18) + Math.sin(t * 0.0004 + b) * 30
        const g = ctx.createLinearGradient(0, yy - 90, 0, yy + 90)
        const c1 = b === 1 ? 'rgba(120,255,200,0.16)' : 'rgba(150,170,255,0.16)'
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, c1); g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.moveTo(0, yy)
        for (let x = 0; x <= this.w; x += 20) ctx.lineTo(x, yy + Math.sin(x * 0.004 + t * 0.0006 + b) * 40)
        ctx.lineTo(this.w, yy + 120); ctx.lineTo(0, yy + 120); ctx.closePath(); ctx.fill()
      }
    }
    if (type === 'water') {
      ctx.globalAlpha = 0.08; ctx.strokeStyle = accent; ctx.lineWidth = 2
      for (let k = 0; k < 6; k++) {
        ctx.beginPath()
        for (let x = 0; x <= this.w; x += 12) {
          const y = this.h * (0.3 + k * 0.11) + Math.sin(x * 0.006 + t * 0.001 + k) * 14
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }
    if (type === 'sunrise') {
      const sx = this.w * 0.7, sy = this.h * 0.34
      const g = ctx.createRadialGradient(sx, sy, 4, sx, sy, 260)
      g.addColorStop(0, 'rgba(255,240,200,0.55)'); g.addColorStop(1, 'rgba(255,240,200,0)')
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, 260, 0, 6.28); ctx.fill()
    }
    if (type === 'cyber') {
      ctx.strokeStyle = 'rgba(24,224,255,0.12)'; ctx.lineWidth = 1
      const horizon = this.h * 0.62
      for (let i = -12; i <= 12; i++) { ctx.beginPath(); ctx.moveTo(this.w / 2, horizon); ctx.lineTo(this.w / 2 + i * 120, this.h); ctx.stroke() }
      for (let j = 0; j < 10; j++) { const y = horizon + Math.pow(j / 10, 2) * (this.h - horizon); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.w, y); ctx.stroke() }
    }

    for (const o of this.bgParts) {
      if (type === 'starfield') {
        const a = 0.4 + Math.abs(Math.sin(t * 0.002 * o.sp + o.tw)) * 0.6
        ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 6.28); ctx.fill()
        o.y -= o.sp * 0.2; if (o.y < 0) { o.y = this.h; o.x = rnd(0, this.w) }
      } else if (type === 'snow') {
        o.x += o.vx + Math.sin(t * 0.001 + o.sw) * 0.4; o.y += o.vy
        if (o.y > this.h) { o.y = -5; o.x = rnd(0, this.w) }
        if (o.x < 0) o.x = this.w; if (o.x > this.w) o.x = 0
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 6.28); ctx.fill()
      } else if (type === 'rain') {
        o.x += o.vx; o.y += o.vy; if (o.y > this.h) { o.y = -20; o.x = rnd(0, this.w) }
        ctx.strokeStyle = 'rgba(180,220,255,0.45)'; ctx.lineWidth = 1.2
        ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x - o.vx * 1.2, o.y - o.len); ctx.stroke()
      } else if (type === 'fire') {
        o.y += o.vy; o.x += Math.sin(t * 0.004 + o.life * 6) * 0.6; o.life += 0.012
        const a = Math.max(0, 1 - o.life)
        const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r)
        g.addColorStop(0, `rgba(255,${180 + Math.floor(60 * o.hue)},80,${a * 0.8})`); g.addColorStop(1, 'rgba(255,80,20,0)')
        ctx.globalCompositeOperation = 'lighter'
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 6.28); ctx.fill()
        ctx.globalCompositeOperation = 'source-over'
        if (o.life >= 1) { o.y = rnd(this.h * 0.6, this.h); o.x = rnd(0, this.w); o.r = rnd(6, 20); o.life = 0; o.vy = rnd(-1.6, -0.6) }
      } else if (type === 'bubbles') {
        o.y += o.vy; o.x += Math.sin(t * 0.001 + o.ph) * 0.3
        if (o.y < -10) { o.y = this.h + 10; o.x = rnd(0, this.w) }
        ctx.strokeStyle = `rgba(120,230,200,${0.5 - o.r * 0.02})`; ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 6.28); ctx.stroke()
      } else if (type === 'sakura') {
        o.y += o.vy; o.x += o.vx + Math.sin(t * 0.001 + o.rot) * 0.5; o.rot += o.vr
        if (o.y > this.h) { o.y = -10; o.x = rnd(0, this.w) }
        if (o.x < 0) o.x = this.w; if (o.x > this.w) o.x = 0
        ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.rot); ctx.fillStyle = 'rgba(255,150,185,0.85)'
        ctx.beginPath(); ctx.ellipse(0, 0, o.r * 0.5, o.r, 0, 0, 6.28); ctx.fill(); ctx.restore()
      } else {
        o.y += o.vy; o.x += o.vx + Math.sin(t * 0.001 + o.ph) * 0.2
        if (o.y > this.h) { o.y = -5; o.x = rnd(0, this.w) }
        ctx.fillStyle = `rgba(150,210,255,${0.35 - o.r * 0.05})`; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 6.28); ctx.fill()
      }
    }

    if (type === 'starfield' && Math.random() < 0.003) {
      const sx = rnd(this.w * 0.2, this.w * 0.8), sy = rnd(0, this.h * 0.4)
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - 120, sy + 20); ctx.stroke()
      ctx.restore()
    }

    // soft dreamy bokeh on top of theme motion
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const c1 = toRgb(this.config!.particle) ?? [95, 227, 255]
    const c2 = this.config!.particle2 ? (toRgb(this.config!.particle2) ?? c1) : c1
    for (const b of this.bokeh) {
      b.x += b.vx + Math.sin(t * 0.0005 + b.phase) * 0.1
      b.y += b.vy + Math.cos(t * 0.0004 + b.phase) * 0.08
      if (b.x < -b.r) b.x = this.w + b.r
      if (b.x > this.w + b.r) b.x = -b.r
      if (b.y < -b.r) b.y = this.h + b.r
      if (b.y > this.h + b.r) b.y = -b.r
      const pulse = 0.75 + 0.25 * Math.sin(t * 0.002 + b.phase)
      const t2 = 0.5 + 0.5 * Math.sin(b.hue + b.phase)
      const col: Rgb = [
        Math.round(c1[0] + (c2[0] - c1[0]) * t2),
        Math.round(c1[1] + (c2[1] - c1[1]) * t2),
        Math.round(c1[2] + (c2[2] - c1[2]) * t2),
      ]
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r)
      g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${b.alpha * pulse})`)
      g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`)
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.28); ctx.fill()
    }
    ctx.restore()
  }

  /* ============ particle field (converges to cursor) ============ */
  private drawParticles(staticFrame: boolean): void {
    const ctx = this.fxx
    const cfg = this.config!
    const speed = cfg.speed
    const mx = this.mouse.x
    const my = this.mouse.y
    const active = this.mouse.active

    // Always clear the frame first. In canvas mode drawOverlay() also clears,
    // but the video path calls drawParticles directly — without this, glow
    // particles accumulate frame after frame (additive 'lighter') and grow into
    // an ever-brighter blob that covers the whole window.
    ctx.clearRect(0, 0, this.w, this.h)
    ctx.globalCompositeOperation = 'lighter'

    // cursor dust: tiny particles emitted while the mouse moves
    if (!staticFrame && active) {
      for (let i = this.cursorDust.length - 1; i >= 0; i--) {
        const d = this.cursorDust[i]!
        d.life -= 16
        if (d.life <= 0) { this.cursorDust.splice(i, 1); continue }
        d.x += d.vx
        d.y += d.vy
        d.vx *= 0.94
        d.vy *= 0.94
        const ds = d.r * 3
        ctx.globalAlpha = Math.min(1, d.life / 500) * 0.7
        ctx.drawImage(this.sprites[Math.round(d.t * (this.sprites.length - 1))]!, d.x - ds / 2, d.y - ds / 2, ds, ds)
      }
    }

    for (const p of this.particles) {
      if (!staticFrame) {
        if (cfg.shape === 'bubble') {
          p.vy -= 0.012 * speed
          p.vx += Math.sin(this.time * 0.01 + p.phase) * 0.012 * speed
        } else if (cfg.shape === 'spark') {
          p.vx += (Math.random() - 0.5) * 0.02 * speed
          p.vy += (Math.random() - 0.5) * 0.02 * speed
          p.alpha = 0.4 + 0.45 * (0.5 + 0.5 * Math.sin(this.time * 0.05 + p.phase))
        } else {
          p.vx += Math.cos(p.phase) * 0.004 * speed
          p.vy += Math.sin(p.phase) * 0.004 * speed
        }

        if (active) {
          const dx = mx - p.x
          const dy = my - p.y
          const d2 = dx * dx + dy * dy
          if (d2 < MOUSE_RADIUS * MOUSE_RADIUS) {
            const d = Math.sqrt(d2) + 0.0001
            const pull = (1 - d / MOUSE_RADIUS) * speed * 1.3
            p.vx += (dx / d) * pull
            p.vy += (dy / d) * pull
            // a wider, stronger repulsion ring keeps particles from piling into
            // one dense solid blob right on the cursor
            if (d < 40) {
              const push = (40 - d) * 0.06
              p.vx -= (dx / d) * push
              p.vy -= (dy / d) * push
            }
          }
        }

        p.vx *= 0.92
        p.vy *= 0.92
        // clamp so a fast mouse sweep cannot fling particles across the screen
        const maxV = 3.5
        const vsq = p.vx * p.vx + p.vy * p.vy
        if (vsq > maxV * maxV) {
          const k = maxV / Math.sqrt(vsq)
          p.vx *= k
          p.vy *= k
        }
        p.x += p.vx * 6
        p.y += p.vy * 6

        if (cfg.shape === 'bubble' && p.y < -10) { p.y = this.h + 10; p.x = Math.random() * this.w }
        if (p.x < -20) p.x = this.w + 20
        if (p.x > this.w + 20) p.x = -20
        if (p.y < -20) p.y = this.h + 20
        if (p.y > this.h + 20) p.y = -20
      }

      const s = p.r * 3.2
      ctx.globalAlpha = staticFrame ? p.alpha * 0.6 : p.alpha
      ctx.drawImage(this.sprites[Math.round(p.t * (this.sprites.length - 1))]!, p.x - s / 2, p.y - s / 2, s, s)
    }

    if (cfg.mascot && active && this.auraSprite) {
      if (this.aura.x < -9000) { this.aura.x = mx; this.aura.y = my }
      this.aura.x += (mx - this.aura.x) * 0.08
      this.aura.y += (my - this.aura.y) * 0.08
      const as = 260
      ctx.globalAlpha = 0.28
      ctx.drawImage(this.auraSprite, this.aura.x - as / 2, this.aura.y - as / 2, as, as)

      // pulsing convergence ring + bright core right at the cursor
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 0.04)
      ctx.globalAlpha = 0.14 + 0.08 * pulse
      ctx.strokeStyle = cfg.particle
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(mx, my, 20 + pulse * 8, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 0.5
      ctx.drawImage(this.auraSprite, mx - 12, my - 12, 24, 24)
    }

    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
}

/**
 * Mount the whale-girl ambient stage and keep it in sync with the active skin.
 * Returns a disposer that removes the canvases, video element, and all listeners.
 */
export function startWhaleAmbient(): () => void {
  const engine = new WhaleAmbientEngine()

  const sync = () => {
    const skin = getSkinById(getSkin())
    if (skin.ambient) engine.activate(skin.ambient)
    else engine.deactivate()
  }
  sync()
  const off = subscribeSkin(sync)

  return () => {
    off()
    engine.dispose()
  }
}
