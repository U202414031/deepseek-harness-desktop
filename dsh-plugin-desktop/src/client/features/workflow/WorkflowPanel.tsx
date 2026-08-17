import { useCallback, useState, useSyncExternalStore } from 'react'
import { runStore, workflowStore } from './workflow-store.ts'

/** Format a timestamp as a short relative label. */
function relativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${String(Math.floor(delta / 60_000))} 分钟前`
  if (delta < 86_400_000) return `${String(Math.floor(delta / 3_600_000))} 小时前`
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

const subscribeWorkflows = (listener: () => void): (() => void) => workflowStore.subscribe(listener)
const readWorkflows = (): ReturnType<typeof workflowStore.getSnapshot> => workflowStore.getSnapshot()
const subscribeRuns = (listener: () => void): (() => void) => runStore.subscribe(listener)
const readRuns = (): ReturnType<typeof runStore.getSnapshot> => runStore.getSnapshot()

/**
 * Left-column workflow manager: create, rename, duplicate, delete and select the
 * workflow whose graph the canvas edits.
 */
export function WorkflowPanel(): JSX.Element {
  const { workflows, activeId } = useSyncExternalStore(subscribeWorkflows, readWorkflows)
  const runs = useSyncExternalStore(subscribeRuns, readRuns)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const startRename = useCallback((id: string, name: string) => {
    setEditingId(id)
    setDraftName(name)
    setPendingDelete(null)
  }, [])

  const commitRename = useCallback(() => {
    if (editingId !== null) workflowStore.rename(editingId, draftName)
    setEditingId(null)
    setDraftName('')
  }, [draftName, editingId])

  return (
    <div className="dshDesktopWorkflowPanel">
      <header className="dshDesktopFeatureHeader">
        <h2 className="dshDesktopFeatureTitle">工作流</h2>
        <p className="dshDesktopFeatureSubtitle">在右侧画布上放置节点、连线，编排多个 Agent 协作完成任务。</p>
        <button
          type="button"
          className="dshDesktopPrimaryButton dshDesktopWorkflowNew"
          onClick={() => { workflowStore.create() }}
        >
          ＋ 新建工作流
        </button>
      </header>

      {workflows.length === 0 && (
        <p className="dshDesktopEmptyState">还没有工作流。点击「新建工作流」开始，系统会自动放好「输入 → Agent → 输出」三个节点。</p>
      )}

      <ul className="dshDesktopWorkflowList">
        {workflows.map((workflow) => {
          const selected = workflow.id === activeId
          const running = runs[workflow.id]?.running === true
          const agents = workflow.nodes.filter((node) => node.kind === 'agent').length
          return (
            <li key={workflow.id} className="dshDesktopWorkflowRow">
              {editingId === workflow.id
                ? (
                  <input
                    className="dshDesktopSearchInput"
                    value={draftName}
                    autoFocus
                    aria-label="工作流名称"
                    onChange={(event) => { setDraftName(event.target.value) }}
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitRename()
                      if (event.key === 'Escape') { setEditingId(null); setDraftName('') }
                    }}
                  />
                )
                : (
                  <button
                    type="button"
                    className="dshDesktopWorkflowCard"
                    data-selected={selected || undefined}
                    onClick={() => { workflowStore.setActive(workflow.id) }}
                    onDoubleClick={() => { startRename(workflow.id, workflow.name) }}
                    title="单击选中，双击重命名"
                  >
                    <span className="dshDesktopWorkflowCardName">
                      {workflow.name}
                      {running && <span className="dshDesktopWorkflowRunning">运行中</span>}
                    </span>
                    <span className="dshDesktopWorkflowCardMeta">
                      {String(workflow.nodes.length)} 个节点 · {String(agents)} 个 Agent · {relativeTime(workflow.updatedAt)}
                    </span>
                  </button>
                )}
              <div className="dshDesktopWorkflowRowActions">
                <button
                  type="button"
                  className="dshDesktopIconButton"
                  title="重命名"
                  aria-label="重命名工作流"
                  onClick={() => { startRename(workflow.id, workflow.name) }}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11.2 2.8l2 2L6 12H4v-2z" /><path d="M3 14h10" /></svg>
                </button>
                <button
                  type="button"
                  className="dshDesktopIconButton"
                  title="复制工作流"
                  aria-label="复制工作流"
                  onClick={() => { workflowStore.duplicate(workflow.id) }}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 3.5H4A1.5 1.5 0 002.5 5v6.5" /></svg>
                </button>
                {pendingDelete === workflow.id
                  ? (
                    <button
                      type="button"
                      className="dshDesktopDangerButton dshDesktopWorkflowConfirm"
                      onClick={() => { workflowStore.remove(workflow.id); setPendingDelete(null) }}
                      onBlur={() => { setPendingDelete(null) }}
                      autoFocus
                    >
                      确认删除
                    </button>
                  )
                  : (
                    <button
                      type="button"
                      className="dshDesktopIconButton dshDesktopWorkflowDelete"
                      title="删除工作流"
                      aria-label="删除工作流"
                      onClick={() => { setPendingDelete(workflow.id) }}
                    >
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 5h10" /><path d="M6.5 5V3.5h3V5" /><path d="M4.5 5l.6 8h5.8l.6-8" /></svg>
                    </button>
                  )}
              </div>
            </li>
          )
        })}
      </ul>

      <p className="dshDesktopWorkflowHint">
        提示：节点里的模型与 API Key 复用左栏「API 设置」中保存的密钥，也可以在节点里单独覆盖。
      </p>
    </div>
  )
}
