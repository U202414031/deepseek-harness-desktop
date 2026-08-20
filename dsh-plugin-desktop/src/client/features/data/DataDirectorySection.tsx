import { useCallback, useEffect, useState } from 'react'

/** Owner props supplied by the settings shell. */
export interface DataDirectorySectionProps {
  /** Close the settings panel (shell-owned open state). */
  close: () => void
}

interface DataRootInfo {
  ok: boolean
  root?: string | null
  source?: 'env' | 'settings' | 'none'
  dirs?: {
    dshHome: string
    agentsHome: string
    dropboxDir: string
    desktopUserData: string
    auxDir: string
  } | null
}

interface UpdateResult {
  ok: boolean
  message?: string
  error?: string
}

const SOURCE_LABEL: Record<string, string> = {
  env: '环境变量 DSH_DESKTOP_DATA_DIR',
  settings: '设置文件（settings.yaml）',
  none: '未配置（使用系统默认位置）',
}

/** Settings → 数据目录: shows where every desktop file lives and lets the user relocate the data root. */
export function DataDirectorySection(_props: DataDirectorySectionProps): JSX.Element {
  const [info, setInfo] = useState<DataRootInfo | null>(null)
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setError(null)
    fetch('/desktop/data-root/info')
      .then(response => response.json() as Promise<DataRootInfo>)
      .then(data => {
        setInfo(data)
        setInput(data.root ?? '')
      })
      .catch(() => { setError('无法读取数据目录状态') })
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const save = useCallback(() => {
    setSaving(true)
    setMessage(null)
    setError(null)
    fetch('/desktop/data-root', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dir: input.trim() }),
    })
      .then(response => response.json() as Promise<UpdateResult>)
      .then(data => {
        if (data.ok) {
          setMessage(data.message ?? '已保存')
          refresh()
        } else {
          setError(data.error ?? '保存失败')
        }
      })
      .catch(() => { setError('保存请求失败') })
      .finally(() => { setSaving(false) })
  }, [input, refresh])

  const label: string = SOURCE_LABEL[info?.source ?? 'none'] ?? '未知'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 2px' }}>
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>数据目录</h3>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, opacity: 0.85 }}>
        桌面端的所有数据（DSH 配置与会话、Agent 公共技能、文件上传中转目录、日志与运行状态）
        默认放在系统盘用户目录。设置一个数据根目录后，这些数据会统一存放在该目录下，
        不再占用系统盘。
      </p>

      {info !== null && (
        <div style={{ fontSize: 12, lineHeight: 1.7 }}>
          <div><strong>当前数据根：</strong>{info.root ?? '（未配置）'}</div>
          <div><strong>配置来源：</strong>{label}</div>
          {info.dirs !== null && info.dirs !== undefined && (
            <div style={{ marginTop: 6, opacity: 0.9 }}>
              <div>· DSH 主目录：{info.dirs.dshHome}</div>
              <div>· Agent 公共技能：{info.dirs.agentsHome}</div>
              <div>· 上传中转（dropbox）：{info.dirs.dropboxDir}</div>
              <div>· 桌面端运行数据（日志等）：{info.dirs.desktopUserData}</div>
              <div>· 辅助配置（IM 网关等）：{info.dirs.auxDir}</div>
            </div>
          )}
        </div>
      )}

      {info?.source === 'env' && (
        <p style={{ margin: 0, fontSize: 12, color: '#b45309' }}>
          当前由环境变量 <code>DSH_DESKTOP_DATA_DIR</code> 控制。下面的修改会写入设置文件，
          清除该环境变量后生效；否则环境变量始终优先。
        </p>
      )}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
        数据根目录（绝对路径，如 D:/MyData/desktop-data）
        <input
          type="text"
          value={input}
          onChange={(event) => { setInput(event.target.value) }}
          placeholder="例如 D:/MyData/desktop-data"
          style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(127,127,127,.4)', fontSize: 13 }}
        />
      </label>

      {message !== null && <p style={{ margin: 0, fontSize: 12, color: '#15803d' }}>{message}</p>}
      {error !== null && <p style={{ margin: 0, fontSize: 12, color: '#b91c1c' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          disabled={saving || input.trim().length === 0}
          onClick={() => { void save() }}
          style={{
            padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: '#2563eb', color: '#fff', fontSize: 13, fontWeight: 600,
          }}
        >
          {saving ? '保存中…' : '保存并重启后生效'}
        </button>
        <button
          type="button"
          onClick={refresh}
          style={{
            padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(127,127,127,.4)',
            background: 'transparent', cursor: 'pointer', fontSize: 13,
          }}
        >
          刷新
        </button>
      </div>
    </div>
  )
}
