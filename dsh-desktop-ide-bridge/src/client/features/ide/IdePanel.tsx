import { useCallback, useEffect, useRef, useState } from 'react'
import { basicSetup } from 'codemirror'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { markdown } from '@codemirror/lang-markdown'
import { cpp } from '@codemirror/lang-cpp'
import { java } from '@codemirror/lang-java'
import {
  DESKTOP_IDE_TREE_PATH,
  DESKTOP_IDE_FILE_PATH,
  DESKTOP_IDE_WORKSPACE_PATH,
  type DesktopIdeTreeEntry,
  type DesktopIdeTreeResponse,
  type DesktopIdeFileResponse,
  languageFromPath,
} from '../../../ide-editor-contract.ts'
import { setEditorSelection, trimSelectionText } from './editor-selection.ts'
import { startSessionInFileDir } from './editor-workspace.ts'
import {
  DESKTOP_IDE_ASK_PATH,
  DESKTOP_IDE_CONFIG_PATH,
  DESKTOP_IDE_INFO_PATH,
  DESKTOP_IDE_OPEN_PATH,
  type DesktopIdeConfigResponse,
  type DesktopIdeInfoResponse,
} from '../../../ide-info-contract.ts'
import { DESKTOP_DIRECTORY_PICKER_PATH } from '../../../directory-picker-contract.ts'

/** Map a file path to its CodeMirror language extension (unknown → none). */
function languageExtensionFor(file: string): ReturnType<typeof javascript> | [] {
  switch (languageFromPath(file)) {
    case 'typescript':
    case 'javascript':
      return javascript()
    case 'python':
      return python()
    case 'json':
      return json()
    case 'html':
      return html()
    case 'css':
    case 'scss':
    case 'less':
      return css()
    case 'markdown':
      return markdown()
    case 'c':
    case 'cpp':
      return cpp()
    case 'java':
      return java()
    default:
      return []
  }
}

/**
 * Desktop IDE surface — built-in lightweight editor (CodeMirror 6) + project
 * file tree. The tree is rooted at the active profile directory plus the
 * user-approved directories; files open in the editor and save back to disk
 * through the loopback routes. Selecting code and pressing 解释/修改 forwards
 * the selection to the live agent over the existing ask bridge (explanation
 * lands in the left conversation; modify writes the file and the editor
 * refreshes). The native VS Code linkage stays available as an escape hatch.
 */
export function IdePanel(): React.ReactElement {
  const [roots, setRoots] = useState<Array<{ name: string; path: string }> | null>(null)
  const [treeCache, setTreeCache] = useState<ReadonlyMap<string, DesktopIdeTreeEntry[]>>(new Map())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [openFile, setOpenFile] = useState<DesktopIdeFileResponse | null>(null)
  const [dirty, setDirty] = useState(false)
  const [askMsg, setAskMsg] = useState<string | null>(null)
  const [info, setInfo] = useState<DesktopIdeInfoResponse | null>(null)
  const [config, setConfig] = useState<DesktopIdeConfigResponse>({ allowedDirs: [] })
  const [newDir, setNewDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirError, setDirError] = useState<string | null>(null)
  const [openMsg, setOpenMsg] = useState<string | null>(null)
  const [dirsOpen, setDirsOpen] = useState(false)
  const editorHostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const fileRef = useRef<string | null>(null)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const [treeWidth, setTreeWidth] = useState(210)
  const [treeCollapsed, setTreeCollapsed] = useState(false)
  const [workspaceDir, setWorkspaceDir] = useState<string | null>(null)

  /** Collapse the file tree so the editor gets the whole panel width. */
  const toggleTree = useCallback(() => {
    setTreeCollapsed(collapsed => !collapsed)
  }, [])

  const onSplitDragStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: event.clientX, startWidth: treeWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [treeWidth])
  const onSplitDragMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag === null) return
    const next = Math.min(420, Math.max(120, drag.startWidth + (event.clientX - drag.startX)))
    setTreeWidth(next)
  }, [])
  const onSplitDragEnd = useCallback(() => {
    dragRef.current = null
  }, [])

  const loadInfo = useCallback(async () => {
    try {
      const res = await fetch(DESKTOP_IDE_INFO_PATH, { headers: { accept: 'application/json' } })
      if (res.ok) setInfo(await res.json() as DesktopIdeInfoResponse)
    } catch {
      // Info is only used for the external VS Code escape hatch; ignore.
    }
  }, [])

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch(DESKTOP_IDE_CONFIG_PATH, { headers: { accept: 'application/json' } })
      if (res.ok) setConfig(await res.json() as DesktopIdeConfigResponse)
    } catch {
      // Same-origin route; ignore transient failures.
    }
  }, [])

  const fetchJson = useCallback(async (url: string): Promise<unknown> => {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
    return await res.json() as unknown
  }, [])

  const refreshRoots = useCallback(async () => {
    try {
      const data = await fetchJson(DESKTOP_IDE_TREE_PATH) as DesktopIdeTreeResponse
      setRoots(data.roots ?? null)
    } catch {
      setRoots([])
    }
  }, [fetchJson])

  useEffect(() => {
    void loadInfo()
    void loadConfig()
    void refreshRoots()
  }, [loadInfo, loadConfig, refreshRoots])

  /** Lazy-load one directory's entries (cached). */
  const loadEntries = useCallback(async (dir: string): Promise<DesktopIdeTreeEntry[]> => {
    const cached = treeCache.get(dir)
    if (cached !== undefined) return cached
    const url = `${DESKTOP_IDE_TREE_PATH}?path=${encodeURIComponent(dir)}`
    const data = await fetchJson(url) as DesktopIdeTreeResponse
    const entries = data.entries ?? []
    setTreeCache(prev => new Map(prev).set(dir, entries))
    return entries
  }, [treeCache, fetchJson])

  const toggleDir = useCallback(async (dir: string) => {
    const next = new Set(expanded)
    if (next.has(dir)) {
      next.delete(dir)
      setExpanded(next)
      return
    }
    try {
      await loadEntries(dir)
    } catch {
      // Listing failed (e.g. permission); still expand to show the empty state.
    }
    next.add(dir)
    setExpanded(next)
  }, [expanded, loadEntries])

  /** Register the opened file's directory as the new-conversation workspace. */
  const ensureFileWorkspace = useCallback(async (path: string) => {
    const idx = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
    const dir = idx > 0 ? path.slice(0, idx) : path
    try {
      const res = await fetch(DESKTOP_IDE_WORKSPACE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dir }),
      })
      if (res.ok) setWorkspaceDir(dir)
    } catch {
      // Workspace registration is a convenience; never block file opening.
    }
  }, [])

  /** Start a new conversation in the opened file's directory. */
  const startConversationHere = useCallback(async () => {
    const path = fileRef.current
    if (path === null) return
    const idx = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
    const dir = idx > 0 ? path.slice(0, idx) : path
    const ok = await startSessionInFileDir(dir)
    setAskMsg(ok ? `已在 ${dir} 新开对话` : '无法在该目录新开对话（工作区服务不可用）')
  }, [])

  const openFileHandler = useCallback(async (path: string) => {
    setEditorSelection(null)
    try {
      const data = await fetchJson(`${DESKTOP_IDE_FILE_PATH}?path=${encodeURIComponent(path)}`) as DesktopIdeFileResponse
      fileRef.current = data.path
      setOpenFile(data)
      setDirty(false)
      setAskMsg(null)
      void ensureFileWorkspace(data.path)
    } catch {
      setAskMsg(`打开文件失败：${path}`)
    }
  }, [fetchJson, ensureFileWorkspace])

  const saveFile = useCallback(async () => {
    const view = viewRef.current
    const path = fileRef.current
    if (view === null || path === null) return
    const content = view.state.doc.toString()
    setBusy(true)
    try {
      const res = await fetch(DESKTOP_IDE_FILE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, content }),
      })
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
      setDirty(false)
      setAskMsg('已保存')
    } catch (cause) {
      setAskMsg(cause instanceof Error ? `保存失败：${cause.message}` : '保存失败')
    } finally {
      setBusy(false)
    }
  }, [])

  const refreshFile = useCallback(async () => {
    const path = fileRef.current
    if (path === null) return
    await openFileHandler(path)
  }, [openFileHandler])

  const refreshAll = useCallback(async () => {
    setTreeCache(new Map())
    setExpanded(new Set())
    await refreshRoots()
    await refreshFile()
  }, [refreshRoots, refreshFile])

  /** Send the current selection (or the whole document) to the agent. */
  const askAgent = useCallback(async (mode: 'explain' | 'modify') => {
    const view = viewRef.current
    const path = fileRef.current
    if (view === null || path === null) return
    const selection = view.state.selection.main
    const selected = selection.empty
      ? view.state.doc.toString()
      : view.state.sliceDoc(selection.from, selection.to)
    const payload = selected.length > 60_000
      ? `${selected.slice(0, 60_000)}\n\n…（内容过长已截断）`
      : selected
    setBusy(true)
    setAskMsg(null)
    try {
      const res = await fetch(DESKTOP_IDE_ASK_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          file: path,
          selection: payload,
          language: languageFromPath(path),
          mode,
        }),
      })
      if (res.ok) {
        setAskMsg(mode === 'explain' ? '已发送给 AI，解释将出现在左侧对话中。' : '已发送给 AI，修改后将写回文件，点「刷新」查看。')
      } else if (res.status === 409) {
        setAskMsg('请先在左侧发起一轮 AI 对话以创建会话。')
      } else {
        setAskMsg(`发送给 AI 失败（HTTP ${String(res.status)}）。`)
      }
    } catch (cause) {
      setAskMsg(cause instanceof Error ? `发送失败：${cause.message}` : '发送失败')
    } finally {
      setBusy(false)
    }
  }, [])

  // Create / recreate the CodeMirror view when the open file changes.
  useEffect(() => {
    const host = editorHostRef.current
    if (host === null || openFile === null) return
    const view = new EditorView({
      state: EditorState.create({
        doc: openFile.content,
        extensions: [
          basicSetup,
          keymap.of([
            indentWithTab,
            { key: 'Mod-s', run: () => { void saveFile(); return true } },
          ]),
          EditorView.updateListener.of(update => {
            if (update.docChanged) setDirty(true)
            // Publish the active selection so the chat input's `@` trigger can
            // reference it; an empty selection clears the reference.
            const selection = update.state.selection.main
            if (!selection.empty) {
              const text = update.state.sliceDoc(selection.from, selection.to)
              if (text.trim().length > 0) {
                setEditorSelection({
                  file: openFile.path,
                  text: trimSelectionText(text),
                  language: languageFromPath(openFile.path),
                  updatedAt: Date.now(),
                })
                return
              }
            }
            setEditorSelection(null)
          }),
          languageExtensionFor(openFile.path),
        ],
      }),
      parent: host,
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
      setEditorSelection(null)
    }
    // Recreate per file (content + language).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFile])

  // Clear the shared selection snapshot when the panel unmounts.
  useEffect(() => {
    return () => { setEditorSelection(null) }
  }, [])

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
      const next = await res.json() as DesktopIdeConfigResponse
      setConfig(next)
      await refreshRoots()
    } catch (cause) {
      setDirError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [refreshRoots])

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

  const renderDirsEditor = (): React.ReactElement => (
    <div className="dshDesktopIdeDirs">
      <p className="dshDesktopIdeDirsTitle">允许访问的目录</p>
      <p className="dshDesktopIdeHint">
        文件树只会显示以下目录（含当前配置文件目录）。添加其他项目目录后即可在右侧编辑。
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
  )

  const renderTreeItem = (entry: DesktopIdeTreeEntry, depth: number): React.ReactElement => {
    const isDir = entry.type === 'dir'
    const isExpanded = isDir && expanded.has(entry.path)
    const isSelected = !isDir && openFile !== null && openFile.path === entry.path
    return (
      <div key={entry.path}>
        <button
          type="button"
          className="dshDesktopIdeTreeItem"
          data-depth={depth}
          data-dir={isDir || undefined}
          data-selected={isSelected || undefined}
          title={entry.path}
          onClick={() => {
            if (isDir) void toggleDir(entry.path)
            else void openFileHandler(entry.path)
          }}
        >
          <span className="dshDesktopIdeTreeCaret" aria-hidden="true">
            {isDir ? (isExpanded ? '▾' : '▸') : ''}
          </span>
          <span className="dshDesktopIdeTreeIcon" aria-hidden="true">{isDir ? '📁' : '📄'}</span>
          <span className="dshDesktopIdeTreeName">{entry.name}</span>
        </button>
        {isDir && isExpanded && (
          <div className="dshDesktopIdeTreeChildren">
            <TreeChildren dir={entry.path} depth={depth + 1} loadEntries={loadEntries} onPick={renderTreeItem} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="dshDesktopIde">
      <div className="dshDesktopIdeSplit">
        {!treeCollapsed ? (
          <>
        <aside className="dshDesktopIdeTree" aria-label="项目文件" style={{ width: treeWidth }}>
          <div className="dshDesktopIdeTreeHeader">
            <button
              type="button"
              className="dshDesktopIconButton dshDesktopIdeTreeHeaderBtn"
              title="刷新文件树"
              aria-label="刷新文件树"
              disabled={busy}
              onClick={() => { void refreshAll() }}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5V6h-3.5" /></svg>
            </button>
            <button
              type="button"
              className="dshDesktopIconButton dshDesktopIdeTreeHeaderBtn"
              title="允许访问的目录"
              aria-label="允许访问的目录"
              aria-pressed={dirsOpen}
              onClick={() => { setDirsOpen(open => !open) }}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 4.5h4l1.5 2H14v6.5H2z" /></svg>
            </button>
            {info?.vscode.found === true && (
              <button
                type="button"
                className="dshDesktopIconButton dshDesktopIdeTreeHeaderBtn"
                title="在本机 VS Code 打开项目"
                aria-label="在本机 VS Code 打开项目"
                disabled={busy}
                onClick={() => { void openVSCode() }}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6.5 13.5l-4 1.5V1l4 1.5L13.5 1l1 .5v13l-1 .5zM6.5 2.5v11M13.5 1.5v13" /></svg>
              </button>
            )}
            <span className="dshDesktopIdeTreeHeaderTitle">文件</span>
            <button
              type="button"
              className="dshDesktopIconButton dshDesktopIdeTreeHeaderBtn dshDesktopIdeTreeHeaderBtn--collapse"
              title="收起文件树"
              aria-label="收起文件树"
              onClick={toggleTree}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 4l-4 4 4 4" /></svg>
            </button>
          </div>
          <div className="dshDesktopIdeTreeBody">
            {roots === null ? (
              <p className="dshDesktopEmptyState">正在加载文件树…</p>
            ) : roots.length === 0 ? (
              <p className="dshDesktopEmptyState">（没有可访问的目录，点击目录图标添加）</p>
            ) : (
              roots.map(root => (
                <div key={root.path} className="dshDesktopIdeTreeRoot">
                  <button
                    type="button"
                    className="dshDesktopIdeTreeItem"
                    data-depth={0}
                    data-dir
                    title={root.path}
                    onClick={() => { void toggleDir(root.path) }}
                  >
                    <span className="dshDesktopIdeTreeCaret" aria-hidden="true">{expanded.has(root.path) ? '▾' : '▸'}</span>
                    <span className="dshDesktopIdeTreeIcon" aria-hidden="true">📁</span>
                    <span className="dshDesktopIdeTreeName">{root.name}</span>
                  </button>
                  {expanded.has(root.path) && (
                    <div className="dshDesktopIdeTreeChildren">
                      <TreeChildren dir={root.path} depth={1} loadEntries={loadEntries} onPick={renderTreeItem} />
                    </div>
                  )}
                </div>
              ))
            )}
            {openMsg !== null && <p className="dshDesktopToolsError">{openMsg}</p>}
          </div>
        </aside>

        <div
          className="dshDesktopIdeSplitHandle"
          role="separator"
          aria-orientation="vertical"
          onPointerDown={onSplitDragStart}
          onPointerMove={onSplitDragMove}
          onPointerUp={onSplitDragEnd}
          onPointerCancel={onSplitDragEnd}
        />
          </>
        ) : (
          <button
            type="button"
            className="dshDesktopIdeTreeReopen"
            title="展开文件树"
            aria-label="展开文件树"
            onClick={toggleTree}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
          </button>
        )}

        <section className="dshDesktopIdeEditorArea">
          {openFile === null ? (
            <div className="dshDesktopIdeBoot">
              <p className="dshDesktopIdeBootTitle">从左侧文件树选择文件</p>
              <p className="dshDesktopIdeHint">
                打开后即可查看和编辑；框选代码后点「解释」/「修改」，或在对话输入框输入 <code>@</code> 引用选区后直接提问。
              </p>
            </div>
          ) : (
            <>
              <header className="dshDesktopIdeEditorHeader">
                <span className="dshDesktopIdeEditorFile" title={openFile.path}>{openFile.path}</span>
                {dirty && <span className="dshDesktopIdeDirtyDot" title="有未保存修改">●</span>}
                <div className="dshDesktopIdeEditorActions">
                  <button
                    type="button"
                    className="dshDesktopIconButton"
                    title="从磁盘重新读取当前文件"
                    aria-label="从磁盘重新读取当前文件"
                    disabled={busy}
                    onClick={() => { void refreshFile() }}
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5V6h-3.5" /></svg>
                  </button>
                  <button
                    type="button"
                    className="dshDesktopSecondaryButton dshDesktopIdeToolbarBtn"
                    disabled={busy}
                    onClick={() => { void startConversationHere() }}
                    title="在左侧对话中新建一个会话，工作区为该文件所在目录"
                  >
                    在此目录新开对话
                  </button>
                  <button
                    type="button"
                    className="dshDesktopSecondaryButton dshDesktopIdeToolbarBtn"
                    disabled={busy}
                    onClick={() => { void saveFile() }}
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    className="dshDesktopSecondaryButton dshDesktopIdeToolbarBtn"
                    disabled={busy}
                    onClick={() => { void askAgent('explain') }}
                  >
                    解释
                  </button>
                  <button
                    type="button"
                    className="dshDesktopSecondaryButton dshDesktopIdeToolbarBtn"
                    disabled={busy}
                    onClick={() => { void askAgent('modify') }}
                  >
                    修改
                  </button>
                </div>
              </header>
              <div className="dshDesktopIdeEditorBody" ref={editorHostRef} />
              {workspaceDir !== null && (
                <p className="dshDesktopIdeHint dshDesktopIdeEditorStatus" title="新对话将在此目录下开始">
                  新对话工作区：{workspaceDir}
                </p>
              )}
              {askMsg !== null && <p className="dshDesktopIdeHint dshDesktopIdeEditorStatus">{askMsg}</p>}
            </>
          )}
        </section>
      </div>

      {dirsOpen && (
        <div className="dshDesktopIdeDirsOverlay">
          <header className="dshDesktopIdeDirsOverlayHeader">
            <span className="dshDesktopIdeDirsOverlayTitle">允许访问的目录</span>
            <button
              type="button"
              className="dshDesktopIconButton"
              title="关闭"
              aria-label="关闭目录管理"
              onClick={() => { setDirsOpen(false) }}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
            </button>
          </header>
          {renderDirsEditor()}
        </div>
      )}
    </div>
  )
}

/** Recursive directory listing rendered on demand. */
function TreeChildren(props: {
  dir: string
  depth: number
  loadEntries: (dir: string) => Promise<DesktopIdeTreeEntry[]>
  onPick: (entry: DesktopIdeTreeEntry, depth: number) => React.ReactElement
}): React.ReactElement {
  const [entries, setEntries] = useState<DesktopIdeTreeEntry[] | null>(null)
  useEffect(() => {
    let cancelled = false
    props.loadEntries(props.dir)
      .then(list => { if (!cancelled) setEntries(list) })
      .catch(() => { if (!cancelled) setEntries([]) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.dir])
  if (entries === null) return <p className="dshDesktopEmptyState">…</p>
  if (entries.length === 0) return <p className="dshDesktopEmptyState">（空）</p>
  return <>{entries.map(entry => props.onPick(entry, props.depth))}</>
}
