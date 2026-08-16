import { getSkin, getSkinById, subscribeSkin } from './skin-service.ts'
import type { WhaleAmbient } from './skins.ts'

/**
 * Themed particle field for atmospheric (鲸鱼娘 / whale-girl) skins.
 *
 * A single fixed, full-window `<canvas>` is mounted above the app chrome with
 * `pointer-events: none`, so it never intercepts input. Particles drift in the
 * skin's palette as tiny specks and, when the pointer is present, nearby
 * particles are pulled straight toward it — they *converge* wherever the mouse
 * goes, with no orbital spin. An optional `bgImage` paints a full-window
 * whale-girl backdrop (the surfaces turn to frosted glass to reveal it). The
 * layer is only active for skins that declare an `ambient` block.
 */

const MOUSE_RADIUS = 260
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

class WhaleAmbientEngine {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly bgEl: HTMLDivElement
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
  private wash: HTMLCanvasElement | null = null
  private time = 0
  private readonly mouse = { x: -9999, y: -9999, active: false }
  private readonly aura = { x: -9999, y: -9999 }

  private readonly onMove = (e: MouseEvent) => {
    this.mouse.x = e.clientX
    this.mouse.y = e.clientY
    this.mouse.active = true
  }
  private readonly onLeave = () => { this.mouse.active = false }
  private readonly onResize = () => this.resize()
  private readonly onVisibility = () => {
    if (document.hidden) this.pause()
    else if (this.config && !REDUCED) this.play()
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.bgEl = document.createElement('div')
    this.bgEl.className = 'dshDesktopWhaleBg'
    this.bgEl.setAttribute('aria-hidden', 'true')
    this.bgEl.style.display = 'none'
    document.body.appendChild(this.bgEl)
  }

  activate(cfg: WhaleAmbient): void {
    this.config = cfg
    const c1 = toRgb(cfg.particle) ?? [95, 227, 255]
    const c2 = cfg.particle2 ? (toRgb(cfg.particle2) ?? c1) : c1
    // Pre-render a small ramp of glow sprites so each particle can be tinted
    // along the two-color gradient cheaply (no per-frame gradient creation).
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
    // Full-window whale-girl backdrop (if the skin supplies one). Surfaces are
    // switched to frosted glass via the `data-whale-bg` flag set on <html>.
    if (cfg.bgImage) {
      this.bgEl.style.backgroundImage = `url("${cfg.bgImage}")`
      this.bgEl.style.display = 'block'
      document.documentElement.dataset.whaleBg = '1'
    } else {
      this.bgEl.style.display = 'none'
      delete document.documentElement.dataset.whaleBg
    }
    this.resize()
    if (!this.running) {
      this.running = true
      if (REDUCED) this.drawStatic()
      else this.play()
    }
  }

  deactivate(): void {
    this.config = null
    this.running = false
    this.pause()
    this.bgEl.style.display = 'none'
    delete document.documentElement.dataset.whaleBg
    this.ctx.clearRect(0, 0, this.w, this.h)
    this.particles = []
    this.wash = null
  }

  dispose(): void {
    this.deactivate()
    this.bgEl.remove()
    globalThis.removeEventListener('mousemove', this.onMove)
    globalThis.removeEventListener('mouseout', this.onLeave)
    globalThis.removeEventListener('resize', this.onResize)
    document.removeEventListener('visibilitychange', this.onVisibility)
  }

  private play(): void {
    if (!this.listenersBound) {
      globalThis.addEventListener('mousemove', this.onMove)
      globalThis.addEventListener('mouseout', this.onLeave)
      globalThis.addEventListener('resize', this.onResize)
      document.addEventListener('visibilitychange', this.onVisibility)
      this.listenersBound = true
    }
    this.loop()
  }

  private pause(): void {
    cancelAnimationFrame(this.raf)
  }

  private resize(): void {
    this.w = globalThis.innerWidth
    this.h = globalThis.innerHeight
    this.dpr = Math.min(globalThis.devicePixelRatio || 1, 2)
    this.canvas.width = Math.floor(this.w * this.dpr)
    this.canvas.height = Math.floor(this.h * this.dpr)
    this.canvas.style.width = `${this.w}px`
    this.canvas.style.height = `${this.h}px`
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    if (this.config) {
      this.seed()
      this.buildWash()
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
      // Small specks: 0.4–1.2px base radius, drawn a touch larger for glow.
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

  private buildWash(): void {
    const cfg = this.config!
    if (!cfg.bgWash || cfg.bgImage) { this.wash = null; return }
    const wc = document.createElement('canvas')
    wc.width = this.w
    wc.height = this.h
    const g = wc.getContext('2d')!
    const { from, to, kind } = cfg.bgWash
    const grad = kind === 'linear'
      ? g.createLinearGradient(0, 0, this.w, this.h)
      : g.createRadialGradient(this.w / 2, this.h * 0.08, 0, this.w / 2, this.h * 0.08, Math.max(this.w, this.h))
    grad.addColorStop(0, from)
    grad.addColorStop(1, to)
    g.fillStyle = grad
    g.fillRect(0, 0, this.w, this.h)
    this.wash = wc
  }

  private drawStatic(): void {
    // Reduced-motion: render a single calm frame, no animation loop.
    this.ctx.clearRect(0, 0, this.w, this.h)
    this.paintWash()
    for (const p of this.particles) {
      const s = p.r * 3.2
      this.ctx.globalAlpha = p.alpha * 0.5
      this.ctx.drawImage(this.sprites[Math.round(p.t * (this.sprites.length - 1))]!, p.x - s / 2, p.y - s / 2, s, s)
    }
    this.ctx.globalAlpha = 1
  }

  private paintWash(): void {
    if (!this.wash || !this.config) return
    this.ctx.globalCompositeOperation = 'source-over'
    this.ctx.globalAlpha = this.config.bgWashAlpha
    this.ctx.drawImage(this.wash, 0, 0, this.w, this.h)
    this.ctx.globalAlpha = 1
  }

  private loop = (): void => {
    if (!this.running || this.config === null) return
    this.time += 1
    const cfg = this.config
    const dt = Math.min(2, 16 / 16) // normalized step
    const speed = cfg.speed
    const mx = this.mouse.x
    const my = this.mouse.y
    const active = this.mouse.active

    this.ctx.clearRect(0, 0, this.w, this.h)
    this.paintWash()
    this.ctx.globalCompositeOperation = 'lighter'

    for (const p of this.particles) {
      // --- ambient drift by shape ---
      if (cfg.shape === 'bubble') {
        p.vy -= 0.012 * speed
        p.vx += Math.sin(this.time * 0.01 + p.phase) * 0.012 * speed
      } else if (cfg.shape === 'spark') {
        p.vx += (Math.random() - 0.5) * 0.02 * speed
        p.vy += (Math.random() - 0.5) * 0.02 * speed
        p.alpha = 0.4 + 0.45 * (0.5 + 0.5 * Math.sin(this.time * 0.05 + p.phase))
      } else { // star
        p.vx += Math.cos(p.phase) * 0.004 * speed
        p.vy += Math.sin(p.phase) * 0.004 * speed
      }

      // --- convergence toward the cursor (radial pull only, no spin) ---
      if (active) {
        const dx = mx - p.x
        const dy = my - p.y
        const d2 = dx * dx + dy * dy
        if (d2 < MOUSE_RADIUS * MOUSE_RADIUS) {
          const d = Math.sqrt(d2) + 0.0001
          const pull = (1 - d / MOUSE_RADIUS) * speed * 1.1
          // straight pull toward the cursor
          p.vx += (dx / d) * pull
          p.vy += (dy / d) * pull
          // soft shell: keep a small halo so they gather around, not on, the point
          if (d < 16) {
            const push = (16 - d) * 0.05
            p.vx -= (dx / d) * push
            p.vy -= (dy / d) * push
          }
        }
      }

      // damping + integrate
      p.vx *= 0.92
      p.vy *= 0.92
      p.x += p.vx * dt * 6
      p.y += p.vy * dt * 6

      // wrap / recycle
      if (cfg.shape === 'bubble' && p.y < -10) { p.y = this.h + 10; p.x = Math.random() * this.w }
      if (p.x < -20) p.x = this.w + 20
      if (p.x > this.w + 20) p.x = -20
      if (p.y < -20) p.y = this.h + 20
      if (p.y > this.h + 20) p.y = -20

      // Tiny glowing specks — keep the draw size small so they read as fine
      // motes of light rather than blobs.
      const s = p.r * 3.2
      this.ctx.globalAlpha = p.alpha
      this.ctx.drawImage(this.sprites[Math.round(p.t * (this.sprites.length - 1))]!, p.x - s / 2, p.y - s / 2, s, s)
    }

    // --- the whale-girl's presence: a soft aura that trails the cursor ---
    if (cfg.mascot && active && this.auraSprite) {
      if (this.aura.x < -9000) { this.aura.x = mx; this.aura.y = my }
      this.aura.x += (mx - this.aura.x) * 0.08
      this.aura.y += (my - this.aura.y) * 0.08
      const as = 260
      this.ctx.globalAlpha = 0.28
      this.ctx.drawImage(this.auraSprite, this.aura.x - as / 2, this.aura.y - as / 2, as, as)
    }

    this.ctx.globalAlpha = 1
    this.ctx.globalCompositeOperation = 'source-over'
    this.raf = requestAnimationFrame(this.loop)
  }
}

/**
 * Mount the whale-girl ambient layer and keep it in sync with the active skin.
 * Returns a disposer that removes the canvas and all listeners.
 */
export function startWhaleAmbient(): () => void {
  const canvas = document.createElement('canvas')
  canvas.className = 'dshDesktopWhaleAmbient'
  canvas.setAttribute('aria-hidden', 'true')
  document.body.appendChild(canvas)
  const engine = new WhaleAmbientEngine(canvas)

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
    canvas.remove()
  }
}
