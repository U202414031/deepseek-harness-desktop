/**
 * Observable stores behind the workflow feature.
 *
 * `workflowStore` owns the user's workflows and persists them to localStorage
 * (same pattern as the other desktop panels: renderer-local, no host round-trip).
 * `runStore` holds the ephemeral execution state of the current run so switching
 * the left panel away and back does not throw away a running graph's output.
 *
 * Both expose `getSnapshot` / `subscribe` so React can bind them with
 * `useSyncExternalStore`; every mutation replaces the frozen snapshot.
 */

import type { NodeRunStatus, Workflow, WorkflowEdge, WorkflowNode, WorkflowNodeConfig, WorkflowNodeKind } from './workflow-types.ts'
import { createId, createNode, createWorkflow, defaultNodeConfig } from './workflow-types.ts'

const STORAGE_KEY = 'dsh-desktop-workflows'
const ACTIVE_KEY = 'dsh-desktop-workflow-active'

/** Persisted workflow collection plus the current selection. */
export interface WorkflowSnapshot {
  workflows: readonly Workflow[]
  activeId: string | null
}

function readStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    /* storage unavailable — keep the in-memory snapshot */
  }
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function sanitizeConfig(raw: unknown, kind: WorkflowNodeKind): WorkflowNodeConfig {
  const base = defaultNodeConfig(kind)
  if (raw === null || typeof raw !== 'object') return base
  const source = raw as Record<string, unknown>
  return {
    system: str(source.system, base.system),
    prompt: str(source.prompt, base.prompt),
    providerId: str(source.providerId, base.providerId),
    model: str(source.model, base.model),
    baseUrl: str(source.baseUrl, base.baseUrl),
    apiKey: str(source.apiKey, base.apiKey),
    temperature: num(source.temperature, base.temperature),
    maxTokens: num(source.maxTokens, base.maxTokens),
  }
}

function sanitizeNode(raw: unknown): WorkflowNode | null {
  if (raw === null || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const id = str(source.id)
  if (id.length === 0) return null
  const kindRaw = str(source.kind, 'agent')
  const kind: WorkflowNodeKind = kindRaw === 'start' || kindRaw === 'end' || kindRaw === 'agent' ? kindRaw : 'agent'
  return {
    id,
    kind,
    name: str(source.name, kind),
    x: num(source.x, 0),
    y: num(source.y, 0),
    config: sanitizeConfig(source.config, kind),
  }
}

function sanitizeWorkflow(raw: unknown): Workflow | null {
  if (raw === null || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const id = str(source.id)
  if (id.length === 0) return null
  const nodes = Array.isArray(source.nodes)
    ? source.nodes.map(sanitizeNode).filter((node): node is WorkflowNode => node !== null)
    : []
  const ids = new Set(nodes.map((node) => node.id))
  const edges = Array.isArray(source.edges)
    ? source.edges.flatMap((entry): WorkflowEdge[] => {
      if (entry === null || typeof entry !== 'object') return []
      const record = entry as Record<string, unknown>
      const from = str(record.from)
      const to = str(record.to)
      if (!ids.has(from) || !ids.has(to) || from === to) return []
      return [{ id: str(record.id, createId('e')), from, to }]
    })
    : []
  const now = Date.now()
  return {
    id,
    name: str(source.name, '未命名工作流'),
    description: str(source.description),
    nodes,
    edges,
    createdAt: num(source.createdAt, now),
    updatedAt: num(source.updatedAt, now),
  }
}

function loadSnapshot(): WorkflowSnapshot {
  const raw = readStorage(STORAGE_KEY)
  let workflows: Workflow[] = []
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        workflows = parsed.map(sanitizeWorkflow).filter((item): item is Workflow => item !== null)
      }
    } catch {
      workflows = []
    }
  }
  const storedActive = readStorage(ACTIVE_KEY)
  const activeId = storedActive !== null && workflows.some((item) => item.id === storedActive)
    ? storedActive
    : workflows[0]?.id ?? null
  return Object.freeze({ workflows, activeId })
}

/** User-owned workflow collection, persisted in the renderer. */
export class WorkflowStore {
  private snapshot: WorkflowSnapshot = loadSnapshot()
  private readonly listeners = new Set<() => void>()

  /** @returns the immutable current snapshot. */
  getSnapshot(): WorkflowSnapshot {
    return this.snapshot
  }

  /** @param listener - notified after every snapshot replacement. @returns its disposer. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** @returns the selected workflow, or null when the collection is empty. */
  getActive(): Workflow | null {
    const { workflows, activeId } = this.snapshot
    if (activeId === null) return null
    return workflows.find((item) => item.id === activeId) ?? null
  }

  /** Create a workflow (seeded with a start → agent → end skeleton) and select it. @returns its id. */
  create(name?: string): string {
    const label = (name ?? '').trim()
    const workflow = createWorkflow(label.length > 0 ? label : this.nextName())
    this.publish({ workflows: [...this.snapshot.workflows, workflow], activeId: workflow.id })
    return workflow.id
  }

  /** Delete a workflow and move the selection to a neighbour. */
  remove(id: string): void {
    const index = this.snapshot.workflows.findIndex((item) => item.id === id)
    if (index < 0) return
    const workflows = this.snapshot.workflows.filter((item) => item.id !== id)
    const fallback = workflows[Math.min(index, workflows.length - 1)]?.id ?? null
    this.publish({ workflows, activeId: this.snapshot.activeId === id ? fallback : this.snapshot.activeId })
  }

  /** Rename a workflow; blank names are ignored. */
  rename(id: string, name: string): void {
    const trimmed = name.trim()
    if (trimmed.length === 0) return
    this.patchWorkflow(id, (workflow) => ({ ...workflow, name: trimmed }))
  }

  /** Copy a workflow (fresh ids) and select the copy. @returns the new id. */
  duplicate(id: string): string | null {
    const source = this.snapshot.workflows.find((item) => item.id === id)
    if (source === undefined) return null
    const idMap = new Map<string, string>()
    const nodes = source.nodes.map((node) => {
      const nextId = createId('n')
      idMap.set(node.id, nextId)
      return { ...node, id: nextId, config: { ...node.config } }
    })
    const edges = source.edges.flatMap((edge): WorkflowEdge[] => {
      const from = idMap.get(edge.from)
      const to = idMap.get(edge.to)
      if (from === undefined || to === undefined) return []
      return [{ id: createId('e'), from, to }]
    })
    const now = Date.now()
    const copy: Workflow = {
      id: createId('wf'),
      name: `${source.name} 副本`,
      description: source.description,
      nodes,
      edges,
      createdAt: now,
      updatedAt: now,
    }
    this.publish({ workflows: [...this.snapshot.workflows, copy], activeId: copy.id })
    return copy.id
  }

  /** Select a workflow by id (no-op for unknown ids). */
  setActive(id: string): void {
    if (this.snapshot.activeId === id) return
    if (!this.snapshot.workflows.some((item) => item.id === id)) return
    this.publish({ ...this.snapshot, activeId: id })
  }

  /** Place a node on the canvas. @returns the new node id, or null when the workflow is gone. */
  addNode(workflowId: string, kind: WorkflowNodeKind, x: number, y: number): string | null {
    const workflow = this.snapshot.workflows.find((item) => item.id === workflowId)
    if (workflow === undefined) return null
    const count = workflow.nodes.filter((node) => node.kind === kind).length
    const name = kind === 'agent' ? `Agent ${String(count + 1)}` : undefined
    const node = createNode(kind, x, y, name)
    this.patchWorkflow(workflowId, (current) => ({ ...current, nodes: [...current.nodes, node] }))
    return node.id
  }

  /** Move a node to a new canvas position. */
  moveNode(workflowId: string, nodeId: string, x: number, y: number): void {
    this.patchNode(workflowId, nodeId, (node) => ({ ...node, x: Math.round(x), y: Math.round(y) }))
  }

  /** Rename a node; blank names are ignored. */
  renameNode(workflowId: string, nodeId: string, name: string): void {
    const trimmed = name.trim()
    if (trimmed.length === 0) return
    this.patchNode(workflowId, nodeId, (node) => ({ ...node, name: trimmed }))
  }

  /** Merge a partial model configuration into a node. */
  updateNodeConfig(workflowId: string, nodeId: string, patch: Partial<WorkflowNodeConfig>): void {
    this.patchNode(workflowId, nodeId, (node) => ({ ...node, config: { ...node.config, ...patch } }))
  }

  /** Delete a node together with every edge touching it. */
  removeNode(workflowId: string, nodeId: string): void {
    this.patchWorkflow(workflowId, (workflow) => ({
      ...workflow,
      nodes: workflow.nodes.filter((node) => node.id !== nodeId),
      edges: workflow.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
    }))
  }

  /**
   * Connect two nodes.
   * @returns true when a new edge was added; false for self-links, unknown
   *          nodes, duplicates, or links that would close a cycle.
   */
  connect(workflowId: string, from: string, to: string): boolean {
    const workflow = this.snapshot.workflows.find((item) => item.id === workflowId)
    if (workflow === undefined || from === to) return false
    const known = new Set(workflow.nodes.map((node) => node.id))
    if (!known.has(from) || !known.has(to)) return false
    if (workflow.edges.some((edge) => edge.from === from && edge.to === to)) return false
    if (reaches(workflow.edges, to, from)) return false
    const edge: WorkflowEdge = { id: createId('e'), from, to }
    this.patchWorkflow(workflowId, (current) => ({ ...current, edges: [...current.edges, edge] }))
    return true
  }

  /** Remove one edge by id. */
  disconnect(workflowId: string, edgeId: string): void {
    this.patchWorkflow(workflowId, (workflow) => ({
      ...workflow,
      edges: workflow.edges.filter((edge) => edge.id !== edgeId),
    }))
  }

  private nextName(): string {
    const used = new Set(this.snapshot.workflows.map((item) => item.name))
    for (let index = 1; index < 1000; index += 1) {
      const candidate = `工作流 ${String(index)}`
      if (!used.has(candidate)) return candidate
    }
    return `工作流 ${String(Date.now())}`
  }

  private patchNode(workflowId: string, nodeId: string, patch: (node: WorkflowNode) => WorkflowNode): void {
    this.patchWorkflow(workflowId, (workflow) => ({
      ...workflow,
      nodes: workflow.nodes.map((node) => (node.id === nodeId ? patch(node) : node)),
    }))
  }

  private patchWorkflow(workflowId: string, patch: (workflow: Workflow) => Workflow): void {
    let touched = false
    const workflows = this.snapshot.workflows.map((workflow) => {
      if (workflow.id !== workflowId) return workflow
      touched = true
      return { ...patch(workflow), updatedAt: Date.now() }
    })
    if (!touched) return
    this.publish({ ...this.snapshot, workflows })
  }

  private publish(next: WorkflowSnapshot): void {
    this.snapshot = Object.freeze(next)
    writeStorage(STORAGE_KEY, JSON.stringify(next.workflows))
    writeStorage(ACTIVE_KEY, next.activeId ?? '')
    for (const listener of this.listeners) listener()
  }
}

/** @returns true when `target` is reachable from `origin` by following edges. */
function reaches(edges: readonly WorkflowEdge[], origin: string, target: string): boolean {
  const seen = new Set<string>()
  const queue = [origin]
  while (queue.length > 0) {
    const current = queue.pop()
    if (current === undefined || seen.has(current)) continue
    if (current === target) return true
    seen.add(current)
    for (const edge of edges) {
      if (edge.from === current) queue.push(edge.to)
    }
  }
  return false
}

/** Per-node execution state within a run. */
export interface NodeRunState {
  status: NodeRunStatus
  output: string
  error: string
  /** Wall-clock duration in milliseconds; zero while pending. */
  ms: number
}

/** Ephemeral execution state of one workflow. */
export interface WorkflowRunState {
  running: boolean
  /** Text fed into the graph's start nodes. */
  input: string
  nodes: Readonly<Record<string, NodeRunState>>
  logs: readonly string[]
  error: string
}

const EMPTY_NODE_RUN: NodeRunState = Object.freeze({ status: 'idle', output: '', error: '', ms: 0 })
/** Stable default returned for workflows that have never been run. */
export const EMPTY_RUN: WorkflowRunState = Object.freeze({
  running: false,
  input: '',
  nodes: Object.freeze({}),
  logs: Object.freeze([]),
  error: '',
})

/** Ephemeral run state keyed by workflow id. */
export class RunStore {
  private snapshot: Readonly<Record<string, WorkflowRunState>> = Object.freeze({})
  private readonly listeners = new Set<() => void>()

  /** @returns the immutable run map. */
  getSnapshot(): Readonly<Record<string, WorkflowRunState>> {
    return this.snapshot
  }

  /** @param listener - notified after every snapshot replacement. @returns its disposer. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** @returns the run state of a workflow, or a shared empty default. */
  get(workflowId: string): WorkflowRunState {
    return this.snapshot[workflowId] ?? EMPTY_RUN
  }

  /** Store the run input text for a workflow. */
  setInput(workflowId: string, input: string): void {
    this.patch(workflowId, (run) => ({ ...run, input }))
  }

  /** Mark the workflow as running and clear every node result. */
  begin(workflowId: string): void {
    this.patch(workflowId, (run) => ({ ...run, running: true, nodes: {}, logs: [], error: '' }))
  }

  /** Flag one node as executing. */
  nodeStart(workflowId: string, nodeId: string): void {
    this.patchNode(workflowId, nodeId, () => ({ status: 'running', output: '', error: '', ms: 0 }))
  }

  /** Record a node's successful output. */
  nodeDone(workflowId: string, nodeId: string, output: string, ms: number): void {
    this.patchNode(workflowId, nodeId, () => ({ status: 'done', output, error: '', ms }))
  }

  /** Record a node failure. */
  nodeError(workflowId: string, nodeId: string, error: string, ms: number): void {
    this.patchNode(workflowId, nodeId, () => ({ status: 'error', output: '', error, ms }))
  }

  /** Append a line to the run log (capped at 200 entries). */
  log(workflowId: string, line: string): void {
    this.patch(workflowId, (run) => ({ ...run, logs: [...run.logs, line].slice(-200) }))
  }

  /** Mark the run finished, optionally with a graph-level error. */
  finish(workflowId: string, error = ''): void {
    this.patch(workflowId, (run) => ({ ...run, running: false, error }))
  }

  /** Drop every result for a workflow. */
  reset(workflowId: string): void {
    this.patch(workflowId, (run) => ({ ...run, running: false, nodes: {}, logs: [], error: '' }))
  }

  private patchNode(workflowId: string, nodeId: string, patch: (node: NodeRunState) => NodeRunState): void {
    this.patch(workflowId, (run) => ({
      ...run,
      nodes: { ...run.nodes, [nodeId]: patch(run.nodes[nodeId] ?? EMPTY_NODE_RUN) },
    }))
  }

  private patch(workflowId: string, patch: (run: WorkflowRunState) => WorkflowRunState): void {
    const current = this.snapshot[workflowId] ?? EMPTY_RUN
    this.snapshot = Object.freeze({ ...this.snapshot, [workflowId]: Object.freeze(patch(current)) })
    for (const listener of this.listeners) listener()
  }
}

/** Shared workflow collection used by both the sidebar list and the canvas. */
export const workflowStore = new WorkflowStore()
/** Shared run state used by the canvas. */
export const runStore = new RunStore()
