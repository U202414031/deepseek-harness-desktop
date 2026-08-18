import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DESKTOP_IDE_CONFIG_PATH,
  DESKTOP_IDE_INFO_PATH,
  DESKTOP_IDE_OPEN_PATH,
  type DesktopIdeConfigResponse,
  type DesktopIdeInfoResponse,
} from '../../../ide-info-contract.ts'
import { DESKTOP_DIRECTORY_PICKER_PATH } from '../../../directory-picker-contract.ts'

/**
 * Desktop IDE surface — VS Code linkage mode. code-server has no official
 * Windows build, so instead of an embedded <iframe> this panel detects the
 * user's natively installed VS Code and offers to open the current workspace
 * there. The selection-bridge extension (synced into VS Code by the host)
 * forwards "explain/modify" selections back to the agent over the loopback
 * bridge. The panel also manages the allowed-directory allow-list that seeds
 * the workspace file.
 */
export function IdePanel(): React.ReactElement {
  const [info, setInfo] = useState<DesktopIdeInfoResponse | null>(null)
  const [config, setConfig] = useState<DesktopIdeConfigResponse>({ allowedDirs: [] })
  const [newDir, setNewDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirError, setDirError] = useState<string | null>(null)
  const [openMsg, setOpenMsg] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch(DESKTOP_IDE_CONFIG_PATH, { headers: { accept: 'application/json' } })
      if (res.ok) setConfig(await res.json() as DesktopIdeConfigResponse)
    } catch {
      // The route is same-origin and always present in advanced mode; ignore.
    }
  }, [])

  const refreshInfo = useCallback(() => {
    let attempts = 0
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch(DESKTOP_IDE_INFO_PATH, { headers: { accept: 'application/json' } })
        if (res.ok) {
          const next = await res.json() as DesktopIdeInfoResponse
          setInfo(next)
          if (next.status === 'ready' || next.status === 'missing' || next.status === 'error') return
        }
      } catch {
        // Loopback route not ready yet; retry.
      }
      if (attempts++ < 30) pollRef.current = setTimeout(() => void tick(), 1_000)
    }
    void tick()
  }, [])

  useEffect(() => {
    void loadConfig()
    refreshInfo()
    return () => { if (pollRef.current !== undefined) clearTimeout(pollRef.current) }
  }, [loadConfig, refreshInfo])

  const applyConfig = useCallback(async (body: { add?: string; remove?: string }) => {
    setBusy(true)
    setDirError(null)
    try {
      const res = await fetch(DESKTOP_IDE_CONFIG_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
      setConfig(await res.json() as DesktopIdeConfigResponse)
    } catch (cause) {
      setDirError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [])

  const addDir = useCallback((dir: string) => {
    const trimmed = dir.trim()
    if (trimmed.length === 0) return
    setNewDir('')
    void applyConfig({ add: trimmed })
  }, [applyConfig])

  const removeDir = useCallback((dir: string) => {
    void applyConfig({ remove: dir })
  }, [applyConfig])

  const pickDirectory = useCallback(async () => {
    try {
      const res = await fetch(DESKTOP_DIRECTORY_PICKER_PATH, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
      const data = await res.json() as { path: string | null }
      if (data.path) addDir(data.path)
      else setDirError('未选择目录')
    } catch {
      setDirError('无法打开系统目录选择器；请手动粘贴绝对路径后点击“添加”。')
    }
  }, [addDir])

  const openVSCode = useCallback(async () => {
    setOpenMsg(null)
    setBusy(true)
    try {
      const res = await fetch(DESKTOP_IDE_OPEN_PATH, { method: 'POST' })
      if (res.ok) {
        setOpenMsg('已发送打开请求，VS Code 应已弹出并加载项目（首次打开可能稍慢）。')
      } else if (res.status === 409) {
        setOpenMsg('未检测到 VS Code，请先安装或设置 DSH_VSCODE_PATH 后重启应用。')
      } else {
        throw new Error(`HTTP ${String(res.status)}`)
      }
    } catch (cause) {
      setOpenMsg(cause instanceof Error ? `打开失败：${cause.message}` : '打开失败')
    } finally {
      setBusy(false)
    }
  }, [])

  const ready = info?.status === 'ready'

  return (
    <div className="dshDesktopIde">
      <div className="dshDesktopIdeBoot">
        {ready ? (
          <>
            <p className="dshDesktopIdeBootTitle">已就绪：联动本机 VS Code</p>
            <p className="dshDesktopIdeHint">
              检测到 VS Code（{info.vscode.path ?? '未知路径'}）。点击下方按钮打开当前项目：
            </p>
            <button
              type="button"
              className="dshDesktopIdeOpenButton"
              disabled={busy}
              onClick={() => { void openVSCode() }}
            >
              在本机 VS Code 打开项目
            </button>
            {openMsg !== null && <p className="dshDesktopIdeHint">{openMsg}</p>}
            <p className="dshDesktopIdeHint">
              打开后：框选一段代码 → <code>Ctrl+Alt+E</code> 让 AI 解释（回复出现在左侧对话），
              <code>Ctrl+Alt+M</code> 让 AI 修改（改动写回文件并显示内联 diff）；编译/运行请用 VS Code 自带终端。
            </p>
            {!info.vscode.extensionReady && (
              <p className="dshDesktopToolsError">桥接扩展未就绪，选区→AI 功能不可用（请重试或手动安装 ide-extension）。</p>
            )}
          </>
        ) : info?.status === 'missing' || info?.status === 'error' ? (
          <>
            <p className="dshDesktopIdeBootTitle">未检测到 VS Code</p>
            <p className="dshDesktopToolsError">{info?.detail ?? '未知错误'}</p>
            <p className="dshDesktopIdeHint">
              请先安装 Visual Studio Code（https://code.visualstudio.com），
              或用环境变量 <code>DSH_VSCODE_PATH</code> 指定 Code.exe 的路径，然后重启应用。
            </p>
          </>
        ) : (
          <>
            <p className="dshDesktopIdeBootTitle">正在检测本机 VS Code…</p>
            <p className="dshDesktopIdeHint">请稍候。</p>
          </>
        )}
      </div>

      <div className="dshDesktopIdeDirs">
        <p className="dshDesktopIdeDirsTitle">允许访问的目录</p>
        <p className="dshDesktopIdeHint">
          打开 VS Code 时只会加载以下目录（含当前配置文件目录）。添加其他项目目录后，下次打开时生效。
        </p>
        <ul className="dshDesktopIdeDirList">
          {config.allowedDirs.length === 0 && (
            <li className="dshDesktopEmptyState">（暂无额外目录，仅配置文件目录）</li>
          )}
          {config.allowedDirs.map(dir => (
            <li key={dir} className="dshDesktopIdeDirItem">
              <span className="dshDesktopIdeDirPath">{dir}</span>
              <button
                type="button"
                className="dshDesktopIconButton"
                title="移除目录"
                aria-label="移除目录"
                onClick={() => { removeDir(dir) }}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
              </button>
            </li>
          ))}
        </ul>
        <div className="dshDesktopIdeAddRow">
          <input
            className="dshDesktopSearchInput"
            placeholder="粘贴绝对路径，例如 C:\Projects\my-app"
            value={newDir}
            onChange={e => { setNewDir(e.target.value) }}
            onKeyDown={e => { if (e.key === 'Enter') addDir(newDir) }}
          />
          <button
            type="button"
            className="dshDesktopSecondaryButton"
            disabled={busy}
            onClick={() => { addDir(newDir) }}
          >
            添加
          </button>
          <button
            type="button"
            className="dshDesktopSecondaryButton"
            disabled={busy}
            onClick={() => { void pickDirectory() }}
          >
            浏览…
          </button>
        </div>
        {dirError !== null && <p className="dshDesktopToolsError">{dirError}</p>}
      </div>
    </div>
  )
}
