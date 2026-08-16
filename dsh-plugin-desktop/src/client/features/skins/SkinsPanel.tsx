import { useSyncExternalStore } from 'react'
import { SKINS } from './skins.ts'
import { getSkin, setSkin, subscribeSkin } from './skin-service.ts'

/** Desktop-owned skin picker rendered in the left column. */
export function SkinsPanel(): JSX.Element {
  const active = useSyncExternalStore(subscribeSkin, getSkin, getSkin)
  return (
    <div className="dshDesktopSkins">
      <header className="dshDesktopFeatureHeader">
        <h2 className="dshDesktopFeatureTitle">皮肤</h2>
        <p className="dshDesktopFeatureSubtitle">更换 DeepSeek Harness 桌面端的界面皮肤。</p>
      </header>
      <ul className="dshDesktopSkinList">
        {SKINS.map(skin => {
          const selected = skin.id === active
          return (
            <li key={skin.id}>
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
            </li>
          )
        })}
      </ul>
    </div>
  )
}
