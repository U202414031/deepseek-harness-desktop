import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { WorkflowNode, WorkflowNodeKind } from './workflow-types.ts'
import type { NodeRunState, WorkflowRunState } from './workflow-store.ts'
import { EMPTY_RUN, runStore, workflowStore } from './workflow-store.ts'
import { NODE_KIND_LABELS, NODE_WIDTH, edgePath, inputPort, nodeHeight, outputPort } from './workflow-types.ts'
import { PROVIDER_ENDPOINTS, defaultModelFor, findEndpoint } from './model-catalog.ts'
import { runWorkflow, topoOrder } from './workflow-runner.ts'

const MIN_SCALE = 0.4
const MAX_SCALE = 1.8

interface ViewTransform {
  tx: number
  ty: number
  scale: number
}

type DragState =
  | { kind: 'pan'; startX: number; startY: number; tx: number; ty: number }
  | { kind: 'node'; nodeId: string; dx: number; dy: number }
  | { kind: 'link'; from: string }

const subscribeWorkflows = (listener: () => void): (() => void) => workflowStore.subscribe(listener)
const readWorkflows = (): ReturnType<typeof workflowStore.getSnapshot> => workflowStore.getSnapshot()
const subscribeRuns = (listener: () => void): (() => void) => runStore.subscribe(listener)
const readRuns = (): ReturnType<typeof runStore.getSnapshot> => runStore.getSnapshot()

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** One-tap prompt starters shown in the agent inspector. */
const AGENT_PROMPT_TEMPLATES: ReadonlyArray<{ label: string; prompt: string }> = [
  { label: '翻译', prompt: '把下面内容翻译成英文：\n{{input}}' },
  { label: '要点总结', prompt: '用 3 条要点总结{{input}}的核心内容。' },
  { label: '改写口播', prompt: '把{{input}}改写成更口语化、适合短视频口播的版本。' },
  { label: '小红书文案', prompt: '参考「上游节点」的回答，写一段小红书风格的种草文案，带 emoji 和话题标签。' },
  { label: '文本分类', prompt: '判断{{input}}的类别（正面 / 负面 / 中性），只输出类别名称。' },
  { label: '接力润色', prompt: '基于「上游节点」的输出，润色成正式的商务邮件语气。' },
]

/**
 * Coze-style node canvas for the active workflow: place nodes, wire them into an
 * execution order, configure each node's model/API/prompt, and run the graph.
 */
export function WorkflowCanvas(): JSX.Element {
  const { workflows, activeId } = useSyncExternalStore(subscribeWorkflows, readWorkflows)
  const runs = useSyncExternalStore(subscribeRuns, readRuns)
  const workflow = workflows.find((item) => item.id === activeId) ?? null
  const workflowId = workflow?.id ?? ''
  const run: WorkflowRunState = runs[workflowId] ?? EMPTY_RUN

  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [view, setView] = useState<ViewTransform>({ tx: 48, ty: 32, scale: 1 })
  const [dragNode, setDragNode] = useState<{ id: string; x: number; y: number } | null>(null)
  const [linkEnd, setLinkEnd] = useState<{ x: number; y: number } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)

  /** Convert client coordinates into canvas space. */
  const toCanvas = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const rect = rootRef.current?.getBoundingClientRect()
    const left = rect?.left ?? 0
    const top = rect?.top ?? 0
    return { x: (clientX - left - view.tx) / view.scale, y: (clientY - top - view.ty) / view.scale }
  }, [view])

  // Zoom around the cursor. Registered natively so `preventDefault` is allowed
  // (React's onWheel is passive and cannot stop the page from scrolling).
  useEffect(() => {
    const element = rootRef.current
    if (element === null) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      setView((previous) => {
        const scale = clamp(previous.scale * Math.exp(-event.deltaY / 420), MIN_SCALE, MAX_SCALE)
        const ratio = scale / previous.scale
        return { scale, tx: px - (px - previous.tx) * ratio, ty: py - (py - previous.ty) * ratio }
      })
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => { element.removeEventListener('wheel', onWheel) }
  }, [])

  useEffect(() => { setSelectedId(null) }, [workflowId])
  useEffect(() => () => { abortRef.current?.abort() }, [])

  const selected = workflow?.nodes.find((node) => node.id === selectedId) ?? null

  const positionOf = useCallback((node: WorkflowNode): WorkflowNode => (
    dragNode !== null && dragNode.id === node.id ? { ...node, x: dragNode.x, y: dragNode.y } : node
  ), [dragNode])

  const onPointerDownBackground = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    dragRef.current = { kind: 'pan', startX: event.clientX, startY: event.clientY, tx: view.tx, ty: view.ty }
    rootRef.current?.setPointerCapture(event.pointerId)
    setSelectedId(null)
  }, [view.tx, view.ty])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag === null) return
    if (drag.kind === 'pan') {
      setView((previous) => ({ ...previous, tx: drag.tx + (event.clientX - drag.startX), ty: drag.ty + (event.clientY - drag.startY) }))
      return
    }
    const point = toCanvas(event.clientX, event.clientY)
    if (drag.kind === 'node') {
      setDragNode({ id: drag.nodeId, x: point.x - drag.dx, y: point.y - drag.dy })
      return
    }
    setLinkEnd(point)
  }, [toCanvas])

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    rootRef.current?.releasePointerCapture(event.pointerId)
    if (drag === null) return
    if (drag.kind === 'node') {
      if (dragNode !== null && workflow !== null) workflowStore.moveNode(workflow.id, drag.nodeId, dragNode.x, dragNode.y)
      setDragNode(null)
      return
    }
    if (drag.kind === 'link') {
      setLinkEnd(null)
      if (workflow === null) return
      // Forgiving drop target: connect to whatever node the pointer was released
      // over, instead of requiring a pixel-perfect hit on the 14px port circle.
      const target = document.elementFromPoint(event.clientX, event.clientY)
      const nodeEl = target?.closest('[data-workflow-node]')
      const to = nodeEl?.getAttribute('data-workflow-node')
      if (typeof to === 'string' && to.length > 0 && to !== drag.from) {
        workflowStore.connect(workflow.id, drag.from, to)
      }
    }
  }, [dragNode, workflow])

  const startNodeDrag = useCallback((event: React.PointerEvent<HTMLElement>, node: WorkflowNode) => {
    if (event.button !== 0) return
    event.stopPropagation()
    const point = toCanvas(event.clientX, event.clientY)
    dragRef.current = { kind: 'node', nodeId: node.id, dx: point.x - node.x, dy: point.y - node.y }
    setDragNode({ id: node.id, x: node.x, y: node.y })
    setSelectedId(node.id)
    rootRef.current?.setPointerCapture(event.pointerId)
  }, [toCanvas])

  const startLink = useCallback((event: React.PointerEvent<HTMLElement>, node: WorkflowNode) => {
    if (event.button !== 0) return
    event.stopPropagation()
    dragRef.current = { kind: 'link', from: node.id }
    setLinkEnd(toCanvas(event.clientX, event.clientY))
    rootRef.current?.setPointerCapture(event.pointerId)
  }, [toCanvas])

  /** Place a node at the centre of the current viewport. */
  const addNode = useCallback((kind: WorkflowNodeKind) => {
    if (workflow === null) return
    const rect = rootRef.current?.getBoundingClientRect()
    const width = rect?.width ?? 800
    const height = rect?.height ?? 600
    const centre = toCanvas((rect?.left ?? 0) + width / 2, (rect?.top ?? 0) + height / 2)
    const created = workflowStore.addNode(workflow.id, kind, centre.x - NODE_WIDTH / 2 + (Math.random() * 40 - 20), centre.y - 40 + (Math.random() * 40 - 20))
    if (created !== null) setSelectedId(created)
  }, [toCanvas, workflow])

  const onDoubleClickBackground = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (workflow === null) return
    if ((event.target as HTMLElement).closest('[data-workflow-node]') !== null) return
    const point = toCanvas(event.clientX, event.clientY)
    const created = workflowStore.addNode(workflow.id, 'agent', point.x - NODE_WIDTH / 2, point.y - 40)
    if (created !== null) setSelectedId(created)
  }, [toCanvas, workflow])

  /** Frame every node inside the viewport. */
  const fitView = useCallback(() => {
    if (workflow === null || workflow.nodes.length === 0) return
    const rect = rootRef.current?.getBoundingClientRect()
    const width = rect?.width ?? 800
    const height = rect?.height ?? 600
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const node of workflow.nodes) {
      minX = Math.min(minX, node.x)
      minY = Math.min(minY, node.y)
      maxX = Math.max(maxX, node.x + NODE_WIDTH)
      maxY = Math.max(maxY, node.y + nodeHeight(node.kind))
    }
    const padding = 60
    const scale = clamp(Math.min((width - padding * 2) / Math.max(1, maxX - minX), (height - padding * 2) / Math.max(1, maxY - minY)), MIN_SCALE, 1)
    setView({
      scale,
      tx: (width - (maxX - minX) * scale) / 2 - minX * scale,
      ty: (height - (maxY - minY) * scale) / 2 - minY * scale,
    })
  }, [workflow])

  const order = useMemo(() => (workflow === null ? { order: [], cyclic: false } : topoOrder(workflow.nodes, workflow.edges)), [workflow])

  const onRun = useCallback(() => {
    if (workflow === null || run.running) return
    const controller = new AbortController()
    abortRef.current = controller
    runStore.begin(workflow.id)
    setShowLog(true)
    void (async () => {
      try {
        const summary = await runWorkflow(workflow, run.input, {
          onNodeStart: (id) => { runStore.nodeStart(workflow.id, id) },
          onNodeDone: (id, output, ms) => { runStore.nodeDone(workflow.id, id, output, ms) },
          onNodeError: (id, message, ms) => { runStore.nodeError(workflow.id, id, message, ms) },
          onLog: (line) => { runStore.log(workflow.id, line) },
        }, controller.signal)
        runStore.finish(workflow.id, summary.failed > 0 ? `${String(summary.failed)} 个节点未成功，请查看节点上的错误信息。` : '')
        if (summary.result.trim().length > 0) runStore.log(workflow.id, `— 最终输出 —\n${summary.result}`)
      } catch (cause) {
        runStore.finish(workflow.id, cause instanceof Error ? cause.message : String(cause))
      } finally {
        abortRef.current = null
      }
    })()
  }, [run.input, run.running, workflow])

  const onStop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    if (workflow !== null) {
      runStore.log(workflow.id, '■ 已请求停止运行')
      runStore.finish(workflow.id, '运行已停止。')
    }
  }, [workflow])

  if (workflow === null) {
    return (
      <div className="dshDesktopWorkflowStage">
        <div className="dshDesktopWorkflowBlank">
          <h3>还没有选中工作流</h3>
          <p>在左栏新建一个工作流，然后在这里放置节点、连线并运行。</p>
          <button type="button" className="dshDesktopPrimaryButton" onClick={() => { workflowStore.create() }}>＋ 新建工作流</button>
        </div>
      </div>
    )
  }

  const doneCount = workflow.nodes.filter((node) => run.nodes[node.id]?.status === 'done').length
  const errorCount = workflow.nodes.filter((node) => run.nodes[node.id]?.status === 'error').length

  return (
    <div className="dshDesktopWorkflowStage">
      <header className="dshDesktopWorkflowToolbar">
        <input
          className="dshDesktopWorkflowTitleInput"
          value={workflow.name}
          aria-label="工作流名称"
          onChange={(event) => { workflowStore.rename(workflow.id, event.target.value) }}
        />
        <div className="dshDesktopWorkflowPalette">
          <button type="button" className="dshDesktopSecondaryButton" onClick={() => { addNode('start') }}>＋ 输入</button>
          <button type="button" className="dshDesktopSecondaryButton" onClick={() => { addNode('agent') }}>＋ Agent</button>
          <button type="button" className="dshDesktopSecondaryButton" onClick={() => { addNode('end') }}>＋ 输出</button>
        </div>
        <div className="dshDesktopWorkflowZoom">
          <button type="button" className="dshDesktopIconButton" title="缩小" aria-label="缩小" onClick={() => { setView((p) => ({ ...p, scale: clamp(p.scale - 0.1, MIN_SCALE, MAX_SCALE) })) }}>−</button>
          <span className="dshDesktopWorkflowZoomValue">{String(Math.round(view.scale * 100))}%</span>
          <button type="button" className="dshDesktopIconButton" title="放大" aria-label="放大" onClick={() => { setView((p) => ({ ...p, scale: clamp(p.scale + 0.1, MIN_SCALE, MAX_SCALE) })) }}>＋</button>
          <button type="button" className="dshDesktopSecondaryButton" onClick={fitView}>适应画布</button>
        </div>
      </header>

      <div className="dshDesktopWorkflowBody">
        <div
          ref={rootRef}
          className="dshDesktopWorkflowCanvas"
          data-linking={linkEnd !== null || undefined}
          onPointerDown={onPointerDownBackground}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClickBackground}
        >
          <div
            className="dshDesktopWorkflowLayer"
            style={{ transform: `translate(${String(view.tx)}px, ${String(view.ty)}px) scale(${String(view.scale)})` }}
          >
            <svg className="dshDesktopWorkflowEdges" aria-hidden="true">
              {workflow.edges.map((edge) => {
                const from = workflow.nodes.find((node) => node.id === edge.from)
                const to = workflow.nodes.find((node) => node.id === edge.to)
                if (from === undefined || to === undefined) return null
                const path = edgePath(outputPort(positionOf(from)), inputPort(positionOf(to)))
                const active = run.nodes[edge.from]?.status === 'done' && run.nodes[edge.to]?.status === 'running'
                return (
                  <g key={edge.id} className="dshDesktopWorkflowEdge" data-active={active || undefined}>
                    <path className="dshDesktopWorkflowEdgeLine" d={path} />
                    <path
                      className="dshDesktopWorkflowEdgeHit"
                      d={path}
                      onClick={() => { workflowStore.disconnect(workflow.id, edge.id) }}
                    >
                      <title>点击删除这条连线</title>
                    </path>
                  </g>
                )
              })}
              {linkEnd !== null && (() => {
                const drag = dragRef.current
                if (drag === null || drag.kind !== 'link') return null
                const from = workflow.nodes.find((node) => node.id === drag.from)
                if (from === undefined) return null
                return <path className="dshDesktopWorkflowEdgeDraft" d={edgePath(outputPort(positionOf(from)), linkEnd)} />
              })()}
            </svg>

            {workflow.nodes.map((node) => {
              const placed = positionOf(node)
              return (
                <NodeCard
                  key={node.id}
                  node={placed}
                  state={run.nodes[node.id] ?? null}
                  selected={node.id === selectedId}
                  index={order.order.indexOf(node.id)}
                  onDragStart={(event) => { startNodeDrag(event, placed) }}
                  onLinkStart={(event) => { startLink(event, placed) }}
                  onDelete={() => { workflowStore.removeNode(workflow.id, node.id); setSelectedId(null) }}
                />
              )
            })}
          </div>

          {order.cyclic && (
            <p className="dshDesktopWorkflowWarn">检测到环形连线，运行前请断开循环。</p>
          )}
          <p className="dshDesktopWorkflowTip">拖动空白处平移 · 滚轮缩放 · 双击空白处新增 Agent · 拖动节点右侧圆点连线</p>
        </div>

        {selected !== null && (
          <NodeInspector
            workflowId={workflow.id}
            node={selected}
            state={run.nodes[selected.id] ?? null}
            onClose={() => { setSelectedId(null) }}
          />
        )}
      </div>

      <footer className="dshDesktopWorkflowRunBar">
        <textarea
          className="dshDesktopWorkflowInput"
          placeholder="输入这次运行的初始内容，会传给「输入」节点与下游 Agent（可留空，由节点自身提示词驱动）"
          value={run.input}
          rows={2}
          onChange={(event) => { runStore.setInput(workflow.id, event.target.value) }}
        />
        <div className="dshDesktopWorkflowRunActions">
          {run.running
            ? <button type="button" className="dshDesktopDangerButton" onClick={onStop}>停止</button>
            : <button type="button" className="dshDesktopPrimaryButton" onClick={onRun} disabled={order.cyclic}>▶ 运行工作流</button>}
          <button type="button" className="dshDesktopSecondaryButton" onClick={() => { runStore.reset(workflow.id) }} disabled={run.running}>清空结果</button>
          <button type="button" className="dshDesktopSecondaryButton" onClick={() => { setShowLog((value) => !value) }}>
            {showLog ? '隐藏日志' : '运行日志'}
          </button>
          <span className="dshDesktopWorkflowRunStatus">
            {run.running ? '运行中…' : `完成 ${String(doneCount)}/${String(workflow.nodes.length)}`}
            {errorCount > 0 && <b className="dshDesktopWorkflowRunError"> · 失败 {String(errorCount)}</b>}
          </span>
        </div>
        {run.error.length > 0 && <p className="dshDesktopToolsError">{run.error}</p>}
        {showLog && (
          <pre className="dshDesktopWorkflowLog" role="status">{run.logs.length > 0 ? run.logs.join('\n') : '暂无运行日志。'}</pre>
        )}
      </footer>
    </div>
  )
}

interface NodeCardProps {
  node: WorkflowNode
  state: NodeRunState | null
  selected: boolean
  /** Position in the resolved execution order; negative when unreachable. */
  index: number
  onDragStart: (event: React.PointerEvent<HTMLElement>) => void
  onLinkStart: (event: React.PointerEvent<HTMLElement>) => void
  onDelete: () => void
}

function NodeCard({ node, state, selected, index, onDragStart, onLinkStart, onDelete }: NodeCardProps): JSX.Element {
  const status = state?.status ?? 'idle'
  const provider = findEndpoint(node.config.providerId)
  const preview = state?.error.length ? state.error : state?.output ?? ''
  return (
    <div
      className="dshDesktopWorkflowNode"
      data-workflow-node={node.id}
      data-kind={node.kind}
      data-status={status}
      data-selected={selected || undefined}
      style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: nodeHeight(node.kind) }}
      onPointerDown={onDragStart}
    >
      <header className="dshDesktopWorkflowNodeHead">
        <span className="dshDesktopWorkflowNodeBadge">{NODE_KIND_LABELS[node.kind]}</span>
        <span className="dshDesktopWorkflowNodeName">{node.name}</span>
        {index >= 0 && <span className="dshDesktopWorkflowNodeOrder">#{String(index + 1)}</span>}
        <span className="dshDesktopWorkflowNodeDot" data-status={status} aria-hidden="true" />
        <button
          type="button"
          className="dshDesktopWorkflowNodeDelete"
          title="删除节点"
          aria-label="删除节点"
          onPointerDown={(event) => { event.stopPropagation() }}
          onClick={onDelete}
        >
          ×
        </button>
      </header>
      <div className="dshDesktopWorkflowNodeBody">
        {node.kind === 'agent'
          ? (
            <>
              <span className="dshDesktopWorkflowNodeModel">
                {provider?.label ?? '默认服务商'} · {node.config.model.length > 0 ? node.config.model : '未选模型'}
              </span>
              <span className="dshDesktopWorkflowNodePrompt">{node.config.prompt.length > 0 ? node.config.prompt : '（未填写提示词，默认转发上游输出）'}</span>
            </>
          )
          : (
            <span className="dshDesktopWorkflowNodePrompt">
              {node.kind === 'start' ? '接收运行输入，作为下游起点' : '汇总上游全部输出作为最终结果'}
            </span>
          )}
        {preview.length > 0 && (
          <span className="dshDesktopWorkflowNodeResult" data-error={state?.error.length ? true : undefined}>{preview.slice(0, 90)}</span>
        )}
      </div>
      {node.kind !== 'start' && (
        <span
          className="dshDesktopWorkflowPort"
          data-side="in"
          data-port-node={node.id}
          title="输入端口：把上游节点的圆点拖到这里"
        />
      )}
      {node.kind !== 'end' && (
        <span
          className="dshDesktopWorkflowPort"
          data-side="out"
          title="输出端口：按住拖到下游节点的左侧圆点"
          onPointerDown={onLinkStart}
        />
      )}
    </div>
  )
}

interface NodeInspectorProps {
  workflowId: string
  node: WorkflowNode
  state: NodeRunState | null
  onClose: () => void
}

/** Right-hand drawer editing one node's prompt, provider, model and endpoint. */
function NodeInspector({ workflowId, node, state, onClose }: NodeInspectorProps): JSX.Element {
  const endpoint = findEndpoint(node.config.providerId)
  const presetModels = endpoint?.models ?? []
  const patch = useCallback((values: Parameters<typeof workflowStore.updateNodeConfig>[2]) => {
    workflowStore.updateNodeConfig(workflowId, node.id, values)
  }, [node.id, workflowId])

  return (
    <aside className="dshDesktopWorkflowInspector">
      <header className="dshDesktopWorkflowInspectorHead">
        <h3>节点设置</h3>
        <button type="button" className="dshDesktopIconButton" title="关闭" aria-label="关闭节点设置" onClick={onClose}>×</button>
      </header>

      <label className="dshDesktopSkinField">
        节点名称（可作为下游变量 {'{{'}{node.name}{'}}'}）
        <input
          className="dshDesktopSearchInput"
          value={node.name}
          onChange={(event) => { workflowStore.renameNode(workflowId, node.id, event.target.value) }}
        />
      </label>

      <p className="dshDesktopWorkflowInspectorKind">类型：{NODE_KIND_LABELS[node.kind]}</p>

      {node.kind === 'agent' && (
        <>
          <p className="dshDesktopWorkflowInspectorStep">第 1 步 · 选服务商与模型</p>
          <label className="dshDesktopSkinField">
            调用的服务商 / API
            <select
              className="dshDesktopSearchInput"
              value={node.config.providerId}
              onChange={(event) => {
                const providerId = event.target.value
                patch({ providerId, model: defaultModelFor(providerId) })
              }}
            >
              {PROVIDER_ENDPOINTS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          {endpoint?.hint !== undefined && endpoint.hint.length > 0 && (
            <p className="dshDesktopWorkflowInspectorHint">{endpoint.hint}</p>
          )}

          <label className="dshDesktopSkinField">
            模型（直接填模型名，想用什么填什么）
            <input
              className="dshDesktopSearchInput"
              list={`wfModels-${node.id}`}
              value={node.config.model}
              placeholder={endpoint?.models[0] ?? 'deepseek-chat'}
              onChange={(event) => { patch({ model: event.target.value }) }}
            />
            <datalist id={`wfModels-${node.id}`}>
              {presetModels.map((model) => (<option key={model} value={model} />))}
            </datalist>
          </label>

          <label className="dshDesktopSkinField">
            自定义 API 地址（留空用官方地址 {endpoint?.url || '（自定义服务商必填）'}）
            <input
              className="dshDesktopSearchInput"
              value={node.config.baseUrl}
              placeholder="https://your-gateway.com/v1"
              onChange={(event) => { patch({ baseUrl: event.target.value }) }}
            />
          </label>

          <label className="dshDesktopSkinField">
            单独 API Key（留空则用「API 设置」里保存的密钥）
            <input
              className="dshDesktopSearchInput"
              type="password"
              value={node.config.apiKey}
              placeholder="sk-…"
              onChange={(event) => { patch({ apiKey: event.target.value }) }}
            />
          </label>

          <div className="dshDesktopWorkflowInspectorRow">
            <label className="dshDesktopSkinField">
              温度
              <input
                className="dshDesktopSearchInput"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={node.config.temperature}
                onChange={(event) => { patch({ temperature: Number(event.target.value) }) }}
              />
            </label>
            <label className="dshDesktopSkinField">
              最大回复 tokens（0=默认）
              <input
                className="dshDesktopSearchInput"
                type="number"
                min={0}
                step={128}
                value={node.config.maxTokens}
                onChange={(event) => { patch({ maxTokens: Number(event.target.value) }) }}
              />
            </label>
          </div>

          <label className="dshDesktopSkinField">
            角色设定（system · 这个 Agent 的"身份"，可留空）
            <textarea
              className="dshDesktopSkinTextArea dshDesktopWorkflowTextArea"
              value={node.config.system}
              onChange={(event) => { patch({ system: event.target.value }) }}
            />
          </label>
        </>
      )}

      <p className="dshDesktopWorkflowInspectorStep">
        {node.kind === 'agent' ? '第 2 步 · 写这个节点要做什么（提示词）' : '运行输入为空时使用的默认内容'}
      </p>
      {node.kind === 'agent' && (
        <div className="dshDesktopWorkflowTemplateRow">
          {AGENT_PROMPT_TEMPLATES.map((template) => (
            <button
              type="button"
              key={template.label}
              className="dshDesktopWorkflowTemplateChip"
              onClick={() => { patch({ prompt: template.prompt }) }}
            >
              {template.label}
            </button>
          ))}
        </div>
      )}
      <label className="dshDesktopSkinField">
        {node.kind === 'agent' ? '提示词 / 工作内容' : '默认内容'}
        <textarea
          className="dshDesktopSkinTextArea dshDesktopWorkflowTextArea"
          value={node.config.prompt}
          placeholder={node.kind === 'agent' ? '例如：根据{{input}}写一段产品介绍' : '运行输入为空时，这里的内容会作为{{input}}'}
          onChange={(event) => { patch({ prompt: event.target.value }) }}
        />
      </label>
      <p className="dshDesktopWorkflowInspectorHint">
        可用变量：<code>{'{{input}}'}</code> 上游节点输出 · <code>{'{{origin}}'}</code> 本次运行输入 · <code>{'{{节点名}}'}</code> 任意已完成节点的输出（节点名即左上角显示的名字）
      </p>

      {state !== null && (state.output.length > 0 || state.error.length > 0) && (
        <div className="dshDesktopWorkflowInspectorResult">
          <span className="dshDesktopWorkflowInspectorResultHead">
            本次运行结果{state.ms > 0 ? `（${String(state.ms)}ms）` : ''}
          </span>
          <pre data-error={state.error.length > 0 || undefined}>{state.error.length > 0 ? state.error : state.output}</pre>
        </div>
      )}

      <button
        type="button"
        className="dshDesktopDangerButton dshDesktopWorkflowInspectorDelete"
        onClick={() => { workflowStore.removeNode(workflowId, node.id); onClose() }}
      >
        删除该节点
      </button>
    </aside>
  )
}
