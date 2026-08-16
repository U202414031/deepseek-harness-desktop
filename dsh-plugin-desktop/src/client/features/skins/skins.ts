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
  bgWashAlpha: number
  /** Optional full-window whale-girl backdrop image (any CSS url, including
   *  `file://` paths or data URIs). When set, the desktop surfaces adopt a
   *  frosted-glass treatment so the artwork shows through. */
  bgImage?: string
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
    id: 'whale-abyss',
    label: '深海蓝鲸',
    description: 'DeepSeek 深蓝鲸鱼娘：幽蓝海底与荧光气泡，粒子随光标汇聚。',
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
      bgWash: { from: '#0a2a44', to: '#06121f', kind: 'radial' },
      bgWashAlpha: 0.42,
      bgImage: 'file:///D:/WorkBuddy/deepseek-desk/whale-skins/bg/whale-abyss.jpg',
    },
  },
  {
    id: 'whale-aurora',
    label: '极光鲸歌',
    description: '鲸鱼娘游过极光带：青绿与紫罗兰的流光粒子。',
    variables: {
      '--dsh-desktop-bg': '#0a1026',
      '--dsh-desktop-surface': '#141a38',
      '--dsh-desktop-surface-2': '#1c2347',
      '--dsh-desktop-fg': '#e6ecff',
      '--dsh-desktop-fg-muted': '#8a93c8',
      '--dsh-desktop-border': '#26305c',
      '--dsh-desktop-accent': '#6ad0c4',
      '--dsh-desktop-accent-fg': '#06121f',
      '--dsh-desktop-code-bg': '#0d1430',
      '--dsw-alias-bg-base': '#0a1026',
      '--dsw-alias-bg-elevated': '#141a38',
      '--dsw-alias-fg-base': '#e6ecff',
      '--dsw-alias-fg-muted': '#8a93c8',
      '--dsw-alias-border-l1': '#26305c',
      '--dsw-alias-border-l2': '#26305c',
      '--dsw-alias-accent': '#6ad0c4',
    },
    ambient: {
      particle: '#6ad0c4',
      particle2: '#b98cff',
      glow: 'rgba(120,170,255,0.5)',
      density: 100,
      shape: 'spark',
      speed: 0.55,
      mascot: true,
      bgWash: { from: '#13204a', to: '#0a1026', kind: 'linear' },
      bgWashAlpha: 0.38,
      bgImage: 'file:///D:/WorkBuddy/deepseek-desk/whale-skins/bg/whale-aurora.jpg',
    },
  },
  {
    id: 'whale-dawn',
    label: '晨曦鲸跃',
    description: '鲸鱼娘跃出海面的清晨：暖橙与樱粉的柔光气泡。',
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
      bgWash: { from: '#ffe3d0', to: '#fff3ec', kind: 'linear' },
      bgWashAlpha: 0.3,
      bgImage: 'file:///D:/WorkBuddy/deepseek-desk/whale-skins/bg/whale-dawn.jpg',
    },
  },
  {
    id: 'whale-star',
    label: '星海鲸游',
    description: '鲸鱼娘遨游星海：近黑深空与星座般的星点粒子。',
    variables: {
      '--dsh-desktop-bg': '#05060f',
      '--dsh-desktop-surface': '#0b0d1c',
      '--dsh-desktop-surface-2': '#12152b',
      '--dsh-desktop-fg': '#e8ecff',
      '--dsh-desktop-fg-muted': '#7c84b8',
      '--dsh-desktop-border': '#1b2042',
      '--dsh-desktop-accent': '#8b7bff',
      '--dsh-desktop-accent-fg': '#05060f',
      '--dsh-desktop-code-bg': '#080a16',
      '--dsw-alias-bg-base': '#05060f',
      '--dsw-alias-bg-elevated': '#0b0d1c',
      '--dsw-alias-fg-base': '#e8ecff',
      '--dsw-alias-fg-muted': '#7c84b8',
      '--dsw-alias-border-l1': '#1b2042',
      '--dsw-alias-border-l2': '#1b2042',
      '--dsw-alias-accent': '#8b7bff',
    },
    ambient: {
      particle: '#bcd0ff',
      particle2: '#c79bff',
      glow: 'rgba(150,170,255,0.5)',
      density: 135,
      shape: 'star',
      speed: 0.35,
      mascot: true,
      bgWash: { from: '#10143a', to: '#05060f', kind: 'radial' },
      bgWashAlpha: 0.5,
      bgImage: 'file:///D:/WorkBuddy/deepseek-desk/whale-skins/bg/whale-star.jpg',
    },
  },
  {
    id: 'whale-mint',
    label: '薄荷气泡',
    description: '清新鲸鱼娘：薄荷绿与浅青的灵动气泡海洋。',
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
      bgWash: { from: '#d6f3ec', to: '#eafaf6', kind: 'linear' },
      bgWashAlpha: 0.3,
      bgImage: 'file:///D:/WorkBuddy/deepseek-desk/whale-skins/bg/whale-mint.jpg',
    },
  },
])

/** Resolve a skin definition by id, falling back to the default skin. */
export function getSkinById(id: string): Skin {
  return SKINS.find(skin => skin.id === id) ?? SKINS[0]!
}
