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
])

/** Resolve a skin definition by id, falling back to the default skin. */
export function getSkinById(id: string): Skin {
  return SKINS.find(skin => skin.id === id) ?? SKINS[0]!
}
