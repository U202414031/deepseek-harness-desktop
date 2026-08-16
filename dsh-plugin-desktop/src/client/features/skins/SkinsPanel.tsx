import { useSyncExternalStore, useState } from 'react'
import type { Skin } from './skins.ts'
import {
  deleteCustomSkin, getCatalog, getSkin, saveCustomSkin, setSkin, subscribeCatalog, subscribeSkin,
} from './skin-service.ts'

/** Build the full token map from a compact set of user-picked colors. */
function buildVariables(colors: {
  bg: string
  surface: string
  fg: string
  accent: string
  codeBg: string
}): Record<string, string> {
  return {
    '--dsh-desktop-bg': colors.bg,
    '--dsh-desktop-surface': colors.surface,
    '--dsh-desktop-surface-2': colors.surface,
    '--dsh-desktop-fg': colors.fg,
    '--dsh-desktop-fg-muted': colors.fg,
    '--dsh-desktop-border': colors.surface,
    '--dsh-desktop-accent': colors.accent,
    '--dsh-desktop-accent-fg': '#ffffff',
    '--dsh-desktop-code-bg': colors.codeBg,
    '--dsw-alias-bg-base': colors.bg,
    '--dsw-alias-bg-elevated': colors.surface,
    '--dsw-alias-fg-base': colors.fg,
    '--dsw-alias-fg-muted': colors.fg,
    '--dsw-alias-border-l1': colors.surface,
    '--dsw-alias-border-l2': colors.surface,
    '--dsw-alias-accent': colors.accent,
  }
}

/** Desktop-owned skin picker rendered in the left column. */
export function SkinsPanel(): JSX.Element {
  const active = useSyncExternalStore(subscribeSkin, getSkin, getSkin)
  const catalog = useSyncExternalStore(subscribeCatalog, getCatalog, getCatalog)

  const [name, setName] = useState('')
  const [bg, setBg] = useState('#0b1020')
  const [surface, setSurface] = useState('#121a30')
  const [fg, setFg] = useState('#e8edf7')
  const [accent, setAccent] = useState('#5b8cff')
  const [codeBg, setCodeBg] = useState('#0d1426')
  const [error, setError] = useState<string | null>(null)

  const onCreate = (event: React.FormEvent) => {
    event.preventDefault()
    const label = name.trim()
    if (label.length === 0) {
      setError('请先填写皮肤名称。')
      return
    }
    const id = `custom-${Date.now().toString(36)}`
    const skin: Skin = {
      id,
      label,
      description: '用户自定义皮肤。',
      variables: buildVariables({ bg, surface, fg, accent, codeBg }),
      custom: true,
    }
    saveCustomSkin(skin)
    setSkin(id)
    setName('')
    setError(null)
  }

  return (
    <div className="dshDesktopSkins">
      <header className="dshDesktopFeatureHeader">
        <h2 className="dshDesktopFeatureTitle">皮肤</h2>
        <p className="dshDesktopFeatureSubtitle">更换 DeepSeek Harness 桌面端的界面皮肤，也可创建自己的皮肤。</p>
      </header>
      <ul className="dshDesktopSkinList">
        {catalog.map(skin => {
          const selected = skin.id === active
          return (
            <li key={skin.id}>
              <div className="dshDesktopSkinRow">
                <button
                  type="button"
                  className="dshDesktopSkinCard"
                  data-selected={selected || undefined}
                  aria-pressed={selected}
                  onClick={() => { setSkin(skin.id) }}
                >
                  <span className="dshDesktopSkinSwatch" aria-hidden="true">
                    <span style={{ background: skin.variables['--dsh-desktop-surface'] ?? 'transparent' }} />
                    <span style={{ background: skin.variables['--dsh-desktop-accent'] ?? 'transparent' }} />
                    <span style={{ background: skin.variables['--dsh-desktop-fg'] ?? 'transparent' }} />
                  </span>
                  <span className="dshDesktopSkinMeta">
                    <span className="dshDesktopSkinName">{skin.label}</span>
                    <span className="dshDesktopSkinDesc">{skin.description}</span>
                  </span>
                  {selected && <span className="dshDesktopSkinBadge">使用中</span>}
                </button>
                {skin.custom && (
                  <button
                    type="button"
                    className="dshDesktopDangerButton dshDesktopSkinDelete"
                    aria-label={`删除 ${skin.label}`}
                    onClick={() => { deleteCustomSkin(skin.id) }}
                  >
                    删除
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <form className="dshDesktopSkinCreator" onSubmit={onCreate}>
        <h3 className="dshDesktopSkinCreatorTitle">创建自定义皮肤</h3>
        <label className="dshDesktopSkinField">
          <span>名称</span>
          <input
            type="text"
            className="dshDesktopSearchInput"
            value={name}
            placeholder="例如：我的暗夜紫"
            onChange={(event) => { setName(event.target.value) }}
          />
        </label>
        <div className="dshDesktopSkinColors">
          <label className="dshDesktopColorField">
            <input type="color" value={bg} onChange={(event) => { setBg(event.target.value) }} />
            <span>背景</span>
          </label>
          <label className="dshDesktopColorField">
            <input type="color" value={surface} onChange={(event) => { setSurface(event.target.value) }} />
            <span>面板</span>
          </label>
          <label className="dshDesktopColorField">
            <input type="color" value={fg} onChange={(event) => { setFg(event.target.value) }} />
            <span>文字</span>
          </label>
          <label className="dshDesktopColorField">
            <input type="color" value={accent} onChange={(event) => { setAccent(event.target.value) }} />
            <span>强调</span>
          </label>
          <label className="dshDesktopColorField">
            <input type="color" value={codeBg} onChange={(event) => { setCodeBg(event.target.value) }} />
            <span>代码</span>
          </label>
        </div>
        {error !== null && <p className="dshDesktopMarketplaceNote">{error}</p>}
        <button type="submit" className="dshDesktopPrimaryButton">保存并使用</button>
      </form>
    </div>
  )
}
