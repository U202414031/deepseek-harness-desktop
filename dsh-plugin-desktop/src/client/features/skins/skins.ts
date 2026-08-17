/** A single selectable UI skin for the DSH Desktop client. */
export interface Skin {
  /** Stable identifier persisted to local storage. */
  id: string
  /** Human-readable label shown in the skin picker. */
  label: string
  /** Short description of the palette mood. */
  description: string
  /**
   * CSS custom properties applied to `:root` while the skin is active.
   * Token names use the `dsh-desktop-*` prefix for surfaces this plugin
   * owns; a curated set of upstream `--dsw-alias-*` tokens is also overridden
   * so the broader product chrome re-skins where the names match.
   */
  variables: Record<string, string>
  /** True for skins the user created themselves (persisted separately). */
  custom?: boolean
  /**
   * Optional "atmosphere" layer. When present, the desktop renders a themed
   * particle field (the 鲸鱼娘 / whale-girl motif) that drifts across the
   * surface and converges toward the cursor. Skins without this field stay
   * perfectly still, so built-in utility palettes never pay the animation cost.
   */
  ambient?: WhaleAmbient
}

/**
 * Particle-field configuration for an atmospheric skin.
 * Colors are any CSS color string; the engine derives glow sprites from them.
 */
export interface WhaleAmbient {
  /** Primary particle color. */
  particle: string
  /** Optional secondary color; particles are tinted along a `particle → particle2` gradient. */
  particle2?: string
  /** Glow color used for the cursor-following "whale aura". */
  glow: string
  /** Base particle count before screen-area scaling (clamped at runtime). */
  density: number
  /** Particle behaviour: `bubble` rises, `spark` twinkles, `star` drifts. */
  shape: 'bubble' | 'spark' | 'star'
  /** Global motion-speed multiplier. */
  speed: number
  /** Whether a large soft aura trails the cursor (the whale-girl's presence). */
  mascot: boolean
  /** Optional full-window color wash painted beneath the particles. */
  bgWash?: { from: string; to: string; kind?: 'radial' | 'linear' }
  /** Opacity of `bgWash`, kept low (≤ ~0.5) to protect text readability. */
  bgWashAlpha?: number
  /** Optional full-scene whale-girl backdrop image (any CSS url, including
   *  `file://` paths or data URIs). The character is painted into the scene
   *  itself, so she fuses with the background rather than floating on top. */
  bgImage?: string
  /** Optional seamless looping animated video of the fused scene (character +
   *  environment moving together). When present, the engine plays this as a single
   *  full-screen animated backdrop instead of layering separate images and canvas effects. */
  video?: string
  /** Optional seamless looping *environment-only* video (no character). When
   *  combined with `charFrames`, the engine layers a transparent character
   *  sprite on top so the background keeps moving (falling snow, drifting
   *  petals, rain, fish…) while the character animates independently as a
   *  multi-frame sequence — the mature live2d / video-background pattern. */
  bgVideo?: string
  /** Transparent sprite frames of the character played on top of `bgVideo`.
   *  When the engine reaches the last frame it loops back to the first. */
  charFrames?: string[]
  /** Sprite playback rate in frames per second. Default 8. */
  charFps?: number

  /**
   * Optional *procedural* dynamic overlay rendered on top of the backdrop image
   * (or on a fallback gradient). Adds motion: `water` (flowing currents),
   * `snow` (falling snow), `fire` (flickering flames), `aurora`, `starfield`,
   * `bubbles`, `sakura` (petals), `cyber` (neon grid), `rain`, `sunrise`.
   */
  dynamicBg?: 'water' | 'aurora' | 'sunrise' | 'starfield' | 'bubbles' | 'snow' | 'fire' | 'sakura' | 'cyber' | 'rain'
  /**
   * Optional *transparent* whale-girl cutout layered above the backdrop and
   * animated in 2D (the girl breathes, twirls, flicks her hair…). Lets the
   * character move without turning the whole scene into a stiff still.
   */
  charImage?: string
  /** Animation performed by the `charImage` cutout. */
  charAnim?: 'breath' | 'lookUp' | 'nod' | 'float' | 'wave' | 'twirl' | 'hairFlip' | 'umbrella'
  /**
   * Whether the floating particle field (plus cursor dust and soft bokeh)
   * runs for this skin. Defaults to true. Set false for a clean static or
   * animated backdrop with no drifting particles — used by image/video
   * imported skins whose owners opt out of the particle stream.
   */
  particles?: boolean
}

/**
 * Built-in skin catalog. `default` intentionally carries no overrides so it
 * falls back to the upstream theme tokens; selecting it clears the desktop
 * custom properties entirely.
 */
export const SKINS: readonly Skin[] = Object.freeze([
  {
    id: 'default',
    label: '跟随系统',
    description: '使用 DeepSeek Harness 默认皮肤与明暗主题。',
    variables: {},
  },
  {
    id: 'midnight',
    label: '午夜蓝',
    description: '深蓝底色配合冷调强调色，适合夜间长时间使用。',
    variables: {
      '--dsh-desktop-bg': '#0b1020',
      '--dsh-desktop-surface': '#121a30',
      '--dsh-desktop-surface-2': '#1b2542',
      '--dsh-desktop-fg': '#e8edf7',
      '--dsh-desktop-fg-muted': '#9aa6c4',
      '--dsh-desktop-border': '#27324f',
      '--dsh-desktop-accent': '#5b8cff',
      '--dsh-desktop-accent-fg': '#ffffff',
      '--dsh-desktop-code-bg': '#0d1426',
      '--dsw-alias-bg-base': '#0b1020',
      '--dsw-alias-bg-elevated': '#121a30',
      '--dsw-alias-fg-base': '#e8edf7',
      '--dsw-alias-fg-muted': '#9aa6c4',
      '--dsw-alias-border-l1': '#27324f',
      '--dsw-alias-border-l2': '#27324f',
      '--dsw-alias-accent': '#5b8cff',
    },
  },
  {
    id: 'sunset',
    label: '日落橙',
    description: '暖橙与米色搭配，柔和不刺眼。',
    variables: {
      '--dsh-desktop-bg': '#fbf3ec',
      '--dsh-desktop-surface': '#fffaf5',
      '--dsh-desktop-surface-2': '#f6e7d8',
      '--dsh-desktop-fg': '#3a2a20',
      '--dsh-desktop-fg-muted': '#8a6f5c',
      '--dsh-desktop-border': '#e8d3c0',
      '--dsh-desktop-accent': '#e8703a',
      '--dsh-desktop-accent-fg': '#ffffff',
      '--dsh-desktop-code-bg': '#f4e6d8',
      '--dsw-alias-bg-base': '#fbf3ec',
      '--dsw-alias-bg-elevated': '#fffaf5',
      '--dsw-alias-fg-base': '#3a2a20',
      '--dsw-alias-fg-muted': '#8a6f5c',
      '--dsw-alias-border-l1': '#e8d3c0',
      '--dsw-alias-border-l2': '#e8d3c0',
      '--dsw-alias-accent': '#e8703a',
    },
  },
  {
    id: 'nord',
    label: '极地 Nord',
    description: '低饱和冷色调，源自经典的 Nord 配色。',
    variables: {
      '--dsh-desktop-bg': '#2e3440',
      '--dsh-desktop-surface': '#3b4252',
      '--dsh-desktop-surface-2': '#434c5e',
      '--dsh-desktop-fg': '#eceff4',
      '--dsh-desktop-fg-muted': '#aeb6c4',
      '--dsh-desktop-border': '#4c566a',
      '--dsh-desktop-accent': '#88c0d0',
      '--dsh-desktop-accent-fg': '#2e3440',
      '--dsh-desktop-code-bg': '#272c36',
      '--dsw-alias-bg-base': '#2e3440',
      '--dsw-alias-bg-elevated': '#3b4252',
      '--dsw-alias-fg-base': '#eceff4',
      '--dsw-alias-fg-muted': '#aeb6c4',
      '--dsw-alias-border-l1': '#4c566a',
      '--dsw-alias-border-l2': '#4c566a',
      '--dsw-alias-accent': '#88c0d0',
    },
  },
  {
    id: 'matrix',
    label: '终端绿',
    description: '黑底荧光绿，复古终端风格。',
    variables: {
      '--dsh-desktop-bg': '#040a04',
      '--dsh-desktop-surface': '#081208',
      '--dsh-desktop-surface-2': '#0d1c0d',
      '--dsh-desktop-fg': '#9bffb0',
      '--dsh-desktop-fg-muted': '#4f9f63',
      '--dsh-desktop-border': '#123a1a',
      '--dsh-desktop-accent': '#39ff7a',
      '--dsh-desktop-accent-fg': '#040a04',
      '--dsh-desktop-code-bg': '#061206',
      '--dsw-alias-bg-base': '#040a04',
      '--dsw-alias-bg-elevated': '#081208',
      '--dsw-alias-fg-base': '#9bffb0',
      '--dsw-alias-fg-muted': '#4f9f63',
      '--dsw-alias-border-l1': '#123a1a',
      '--dsw-alias-border-l2': '#123a1a',
      '--dsw-alias-accent': '#39ff7a',
    },
  },
  {
    id: 'lavender',
    label: '薰衣草紫',
    description: '淡紫与柔粉，温润雅致。',
    variables: {
      '--dsh-desktop-bg': '#f6f3fb',
      '--dsh-desktop-surface': '#fffefe',
      '--dsh-desktop-surface-2': '#efe7fa',
      '--dsh-desktop-fg': '#332b45',
      '--dsh-desktop-fg-muted': '#7d7393',
      '--dsh-desktop-border': '#e2d7f0',
      '--dsh-desktop-accent': '#8b5cf6',
      '--dsh-desktop-accent-fg': '#ffffff',
      '--dsh-desktop-code-bg': '#efe7fa',
      '--dsw-alias-bg-base': '#f6f3fb',
      '--dsw-alias-bg-elevated': '#fffefe',
      '--dsw-alias-fg-base': '#332b45',
      '--dsw-alias-fg-muted': '#7d7393',
      '--dsw-alias-border-l1': '#e2d7f0',
      '--dsw-alias-border-l2': '#e2d7f0',
      '--dsw-alias-accent': '#8b5cf6',
    },
  },
  {
    id: 'forest',
    label: '森林绿',
    description: '深林墨绿配琥珀强调色，沉静自然。',
    variables: {
      '--dsh-desktop-bg': '#0f1a14',
      '--dsh-desktop-surface': '#16241c',
      '--dsh-desktop-surface-2': '#1d3026',
      '--dsh-desktop-fg': '#e3efe7',
      '--dsh-desktop-fg-muted': '#8fa896',
      '--dsh-desktop-border': '#274034',
      '--dsh-desktop-accent': '#c9a227',
      '--dsh-desktop-accent-fg': '#0f1a14',
      '--dsh-desktop-code-bg': '#0c150f',
      '--dsw-alias-bg-base': '#0f1a14',
      '--dsw-alias-bg-elevated': '#16241c',
      '--dsw-alias-fg-base': '#e3efe7',
      '--dsw-alias-fg-muted': '#8fa896',
      '--dsw-alias-border-l1': '#274034',
      '--dsw-alias-border-l2': '#274034',
      '--dsw-alias-accent': '#c9a227',
    },
  },
  {
    id: 'graphite',
    label: '石墨灰',
    description: '中性灰阶配青蓝强调，极简专业。',
    variables: {
      '--dsh-desktop-bg': '#1b1d21',
      '--dsh-desktop-surface': '#23262b',
      '--dsh-desktop-surface-2': '#2c3036',
      '--dsh-desktop-fg': '#e7e9ec',
      '--dsh-desktop-fg-muted': '#9aa0a8',
      '--dsh-desktop-border': '#353a41',
      '--dsh-desktop-accent': '#3fb6c4',
      '--dsh-desktop-accent-fg': '#101214',
      '--dsh-desktop-code-bg': '#16181b',
      '--dsw-alias-bg-base': '#1b1d21',
      '--dsw-alias-bg-elevated': '#23262b',
      '--dsw-alias-fg-base': '#e7e9ec',
      '--dsw-alias-fg-muted': '#9aa0a8',
      '--dsw-alias-border-l1': '#353a41',
      '--dsw-alias-border-l2': '#353a41',
      '--dsw-alias-accent': '#3fb6c4',
    },
  },
  {
    id: 'whale-dawn',
    label: '晨曦鲸跃',
    description: '整幅融合壁纸：日出海边栈桥上的水手 JK 鲸鱼娘，暖光与柔光气泡。',
    variables: {
      '--dsh-desktop-bg': '#fff2ea',
      '--dsh-desktop-surface': '#fffaf6',
      '--dsh-desktop-surface-2': '#ffe6d8',
      '--dsh-desktop-fg': '#3a2a26',
      '--dsh-desktop-fg-muted': '#9a7b6e',
      '--dsh-desktop-border': '#f3d9cc',
      '--dsh-desktop-accent': '#ff8a5b',
      '--dsh-desktop-accent-fg': '#ffffff',
      '--dsh-desktop-code-bg': '#ffe9dc',
      '--dsw-alias-bg-base': '#fff2ea',
      '--dsw-alias-bg-elevated': '#fffaf6',
      '--dsw-alias-fg-base': '#3a2a26',
      '--dsw-alias-fg-muted': '#9a7b6e',
      '--dsw-alias-border-l1': '#f3d9cc',
      '--dsw-alias-border-l2': '#f3d9cc',
      '--dsw-alias-accent': '#ff8a5b',
    },
    ambient: {
      particle: '#ffb38a',
      particle2: '#ff8ac0',
      glow: 'rgba(255,160,120,0.4)',
      density: 80,
      shape: 'bubble',
      speed: 0.45,
      mascot: true,
      bgImage: '/desktop/skins/bg/fused-v3/whale-dawn.png',
      video: '/desktop/skins/video/whale-dawn.mp4',
    },
  },
  {
    id: 'whale-mint',
    label: '薄荷气泡',
    description: '整幅融合壁纸：薄荷绿泳池边的清爽泳装鲸鱼娘，晶莹气泡不断上升。',
    variables: {
      '--dsh-desktop-bg': '#eafaf6',
      '--dsh-desktop-surface': '#ffffff',
      '--dsh-desktop-surface-2': '#d9f5ee',
      '--dsh-desktop-fg': '#1f3a34',
      '--dsh-desktop-fg-muted': '#5f8c81',
      '--dsh-desktop-border': '#c4ece1',
      '--dsh-desktop-accent': '#2bc4a0',
      '--dsh-desktop-accent-fg': '#ffffff',
      '--dsh-desktop-code-bg': '#dff7f0',
      '--dsw-alias-bg-base': '#eafaf6',
      '--dsw-alias-bg-elevated': '#ffffff',
      '--dsw-alias-fg-base': '#1f3a34',
      '--dsw-alias-fg-muted': '#5f8c81',
      '--dsw-alias-border-l1': '#c4ece1',
      '--dsw-alias-border-l2': '#c4ece1',
      '--dsw-alias-accent': '#2bc4a0',
    },
    ambient: {
      particle: '#6ff0cf',
      particle2: '#8fe0ff',
      glow: 'rgba(80,220,190,0.4)',
      density: 85,
      shape: 'bubble',
      speed: 0.5,
      mascot: true,
      bgImage: '/desktop/skins/bg/fused-v3/whale-mint.png',
      video: '/desktop/skins/video/whale-mint.mp4',
    },
  },
])

/**
 * 开发中（未上架）的鲸鱼娘皮肤。
 * 配置与资源已就绪，但还未达到上架标准：暂不进入桌面端皮肤列表（getCatalog 只暴露
 * `SKINS`）。质量达标后把这些对象移回 `SKINS` 即可上架。
 */
export const WHALE_DEV_SKINS: readonly Skin[] = Object.freeze([
  {
    id: 'whale-abyss',
    label: '深海蓝鲸',
    description: '整幅融合壁纸：幽蓝水晶宫殿中的深海女仆装鲸鱼娘，水母与气泡环绕。',
    variables: {
      '--dsh-desktop-bg': '#06121f',
      '--dsh-desktop-surface': '#0b2236',
      '--dsh-desktop-surface-2': '#103049',
      '--dsh-desktop-fg': '#dff1ff',
      '--dsh-desktop-fg-muted': '#7fa8c9',
      '--dsh-desktop-border': '#163a55',
      '--dsh-desktop-accent': '#36c9ff',
      '--dsh-desktop-accent-fg': '#04141f',
      '--dsh-desktop-code-bg': '#08263b',
      '--dsw-alias-bg-base': '#06121f',
      '--dsw-alias-bg-elevated': '#0b2236',
      '--dsw-alias-fg-base': '#dff1ff',
      '--dsw-alias-fg-muted': '#7fa8c9',
      '--dsw-alias-border-l1': '#163a55',
      '--dsw-alias-border-l2': '#163a55',
      '--dsw-alias-accent': '#36c9ff',
    },
    ambient: {
      particle: '#5fe3ff',
      particle2: '#7fa8ff',
      glow: 'rgba(95,227,255,0.55)',
      density: 115,
      shape: 'bubble',
      speed: 0.5,
      mascot: true,
      bgVideo: '/desktop/skins/video/whale-abyss-bg.mp4',
      charFrames: [
        '/desktop/skins/bg/sprites/abyss/abyss-frame-1.png',
        '/desktop/skins/bg/sprites/abyss/abyss-frame-2.png',
        '/desktop/skins/bg/sprites/abyss/abyss-frame-3.png',
        '/desktop/skins/bg/sprites/abyss/abyss-frame-4.png',
      ],
      charFps: 6,
    },
  },
  {
    id: 'whale-snow',
    label: '雪地芭蕾',
    description: '整幅融合壁纸：雪夜森林中起舞的芭蕾裙鲸鱼娘，柔雪持续飘落。',
    variables: {
      '--dsh-desktop-bg': '#e9f2fb',
      '--dsh-desktop-surface': '#ffffff',
      '--dsh-desktop-surface-2': '#dce9f6',
      '--dsh-desktop-fg': '#274057',
      '--dsh-desktop-fg-muted': '#6b8299',
      '--dsh-desktop-border': '#c4d8ec',
      '--dsh-desktop-accent': '#7fb4ff',
      '--dsh-desktop-accent-fg': '#ffffff',
      '--dsh-desktop-code-bg': '#e3eefb',
      '--dsw-alias-bg-base': '#e9f2fb',
      '--dsw-alias-bg-elevated': '#ffffff',
      '--dsw-alias-fg-base': '#274057',
      '--dsw-alias-fg-muted': '#6b8299',
      '--dsw-alias-border-l1': '#c4d8ec',
      '--dsw-alias-border-l2': '#c4d8ec',
      '--dsw-alias-accent': '#7fb4ff',
    },
    ambient: {
      particle: '#cfe6ff',
      particle2: '#ffffff',
      glow: 'rgba(150,200,255,0.45)',
      density: 90,
      shape: 'star',
      speed: 0.4,
      mascot: true,
      bgVideo: '/desktop/skins/video/whale-snow-bg.mp4',
      charFrames: [
        '/desktop/skins/bg/sprites/snow/snow-frame-1.png',
        '/desktop/skins/bg/sprites/snow/snow-frame-2.png',
        '/desktop/skins/bg/sprites/snow/snow-frame-3.png',
        '/desktop/skins/bg/sprites/snow/snow-frame-4.png',
      ],
      charFps: 7,
    },
  },
  {
    id: 'whale-sakura',
    label: '樱花鲸鱼娘',
    description: '整幅融合壁纸：樱花树下的和服鲸鱼娘，粉色花瓣随风飘舞。',
    variables: {
      '--dsh-desktop-bg': '#fff0f5',
      '--dsh-desktop-surface': '#fffafc',
      '--dsh-desktop-surface-2': '#ffe3ee',
      '--dsh-desktop-fg': '#5a2a3a',
      '--dsh-desktop-fg-muted': '#b07a8c',
      '--dsh-desktop-border': '#f3cdda',
      '--dsh-desktop-accent': '#ff8fb3',
      '--dsh-desktop-accent-fg': '#ffffff',
      '--dsh-desktop-code-bg': '#ffe9f1',
      '--dsw-alias-bg-base': '#fff0f5',
      '--dsw-alias-bg-elevated': '#fffafc',
      '--dsw-alias-fg-base': '#5a2a3a',
      '--dsw-alias-fg-muted': '#b07a8c',
      '--dsw-alias-border-l1': '#f3cdda',
      '--dsw-alias-border-l2': '#f3cdda',
      '--dsw-alias-accent': '#ff8fb3',
    },
    ambient: {
      particle: '#ffb3cf',
      particle2: '#ffd9e6',
      glow: 'rgba(255,150,190,0.4)',
      density: 80,
      shape: 'bubble',
      speed: 0.45,
      mascot: true,
      bgVideo: '/desktop/skins/video/whale-sakura-bg.mp4',
      charFrames: [
        '/desktop/skins/bg/sprites/sakura/sakura-frame-1.png',
        '/desktop/skins/bg/sprites/sakura/sakura-frame-2.png',
        '/desktop/skins/bg/sprites/sakura/sakura-frame-3.png',
        '/desktop/skins/bg/sprites/sakura/sakura-frame-4.png',
      ],
      charFps: 6,
    },
  },
  {
    id: 'whale-rain',
    label: '雨夜鲸鱼娘',
    description: '整幅融合壁纸：都市雨夜窗边擦泪的鲸鱼娘，斜雨与霓虹交织。',
    variables: {
      '--dsh-desktop-bg': '#0c1620',
      '--dsh-desktop-surface': '#122230',
      '--dsh-desktop-surface-2': '#18303f',
      '--dsh-desktop-fg': '#d6e6f0',
      '--dsh-desktop-fg-muted': '#6f8aa0',
      '--dsh-desktop-border': '#1f3a4d',
      '--dsh-desktop-accent': '#5fb8e6',
      '--dsh-desktop-accent-fg': '#06121f',
      '--dsh-desktop-code-bg': '#0e1b26',
      '--dsw-alias-bg-base': '#0c1620',
      '--dsw-alias-bg-elevated': '#122230',
      '--dsw-alias-fg-base': '#d6e6f0',
      '--dsw-alias-fg-muted': '#6f8aa0',
      '--dsw-alias-border-l1': '#1f3a4d',
      '--dsw-alias-border-l2': '#1f3a4d',
      '--dsw-alias-accent': '#5fb8e6',
    },
    ambient: {
      particle: '#9fd6ff',
      particle2: '#cfeaff',
      glow: 'rgba(120,190,230,0.45)',
      density: 100,
      shape: 'star',
      speed: 0.5,
      mascot: true,
      bgVideo: '/desktop/skins/video/whale-rain-bg.mp4',
      charFrames: [
        '/desktop/skins/bg/sprites/rain/rain-frame-1.png',
        '/desktop/skins/bg/sprites/rain/rain-frame-2.png',
        '/desktop/skins/bg/sprites/rain/rain-frame-3.png',
        '/desktop/skins/bg/sprites/rain/rain-frame-4.png',
      ],
      charFps: 5,
    },
  },
])

/** Resolve a skin definition by id, falling back to the default skin. */
export function getSkinById(id: string): Skin {
  return SKINS.find(skin => skin.id === id) ?? SKINS[0]!
}
