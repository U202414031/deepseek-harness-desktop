/**
 * Data model for the desktop workflow canvas: a directed graph of agent nodes
 * that each call one model with its own prompt, wired together so an upstream
 * node's answer becomes the downstream node's input (multi-agent cooperation).
 *
 * Everything here is plain serialisable data — the store persists it verbatim
 * into localStorage, so keep the shapes JSON-round-trippable (no undefined,
 * no class instances, no functions).
 */

/** Node roles supported by the canvas. */
export type WorkflowNodeKind = 'start' | 'agent' | 'end'

/** Per-node model + prompt configuration edited in the inspector. */
export interface WorkflowNodeConfig {
  /** Role instruction sent as the `system` message. */
  system: string
  /** User message template; `{{input}}` and `{{节点名}}` are interpolated. */
  prompt: string
  /** Provider id from `PROVIDERS` (empty means the workflow default). */
  providerId: string
  /** Model id sent to the provider. */
  model: string
  /** Optional endpoint override; empty means the provider's default URL. */
  baseUrl: string
  /** Optional per-node key; empty falls back to the key saved in API 设置. */
  apiKey: string
  /** Sampling temperature. */
  temperature: number
  /** Response cap; zero means "let the provider decide". */
  maxTokens: number
}

/** One placed node on the canvas. */
export interface WorkflowNode {
  id: string
  kind: WorkflowNodeKind
  /** Display name, also the `{{name}}` template key for downstream nodes. */
  name: string
  /** Canvas-space position of the node's top-left corner. */
  x: number
  y: number
  config: WorkflowNodeConfig
}

/** A directed connection between two nodes. */
export interface WorkflowEdge {
  id: string
  /** Upstream node id (output port). */
  from: string
  /** Downstream node id (input port). */
  to: string
}

/** One named workflow owned by the user. */
export interface Workflow {
  id: string
  name: string
  description: string
  nodes: readonly WorkflowNode[]
  edges: readonly WorkflowEdge[]
  createdAt: number
  updatedAt: number
}

/** Execution status of a single node within the current run. */
export type NodeRunStatus = 'idle' | 'running' | 'done' | 'error'

/** Rendered width of every node card, in canvas units. */
export const NODE_WIDTH = 232
/** Rendered height per node kind, in canvas units. */
export const NODE_HEIGHT: Readonly<Record<WorkflowNodeKind, number>> = {
  start: 76,
  agent: 122,
  end: 76,
}

/** Chinese labels for the node palette and node badges. */
export const NODE_KIND_LABELS: Readonly<Record<WorkflowNodeKind, string>> = {
  start: '开始',
  agent: 'Agent',
  end: '输出',
}

/** @returns a short unique id with the given prefix. */
export function createId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}_${random}`
}

/** @returns the default model configuration for a freshly placed node. */
export function defaultNodeConfig(kind: WorkflowNodeKind): WorkflowNodeConfig {
  return {
    system: kind === 'agent' ? '你是一个专业的助手，请严格按要求完成任务。' : '',
    prompt: kind === 'agent' ? '{{input}}' : '',
    providerId: kind === 'agent' ? 'deepseek' : '',
    model: kind === 'agent' ? 'deepseek-chat' : '',
    baseUrl: '',
    apiKey: '',
    temperature: 0.7,
    maxTokens: 0,
  }
}

/**
 * Build a new node.
 * @param kind - node role.
 * @param x - canvas-space left coordinate.
 * @param y - canvas-space top coordinate.
 * @param name - display name; a kind-derived default is used when omitted.
 */
export function createNode(kind: WorkflowNodeKind, x: number, y: number, name?: string): WorkflowNode {
  return {
    id: createId('n'),
    kind,
    name: name ?? NODE_KIND_LABELS[kind],
    x: Math.round(x),
    y: Math.round(y),
    config: defaultNodeConfig(kind),
  }
}

/**
 * Build a workflow pre-seeded with a start → agent → end skeleton so the canvas
 * is never empty on first open.
 * @param name - workflow display name.
 */
export function createWorkflow(name: string): Workflow {
  const now = Date.now()
  const start = createNode('start', 80, 200, '输入')
  const agent = createNode('agent', 400, 180, 'Agent 1')
  const end = createNode('end', 720, 200, '输出')
  return {
    id: createId('wf'),
    name,
    description: '',
    nodes: [start, agent, end],
    edges: [
      { id: createId('e'), from: start.id, to: agent.id },
      { id: createId('e'), from: agent.id, to: end.id },
    ],
    createdAt: now,
    updatedAt: now,
  }
}

/** @returns the node height for a kind, falling back to the agent height. */
export function nodeHeight(kind: WorkflowNodeKind): number {
  return NODE_HEIGHT[kind] ?? NODE_HEIGHT.agent
}

/** @returns canvas-space centre of a node's output port. */
export function outputPort(node: WorkflowNode): { x: number; y: number } {
  return { x: node.x + NODE_WIDTH, y: node.y + nodeHeight(node.kind) / 2 }
}

/** @returns canvas-space centre of a node's input port. */
export function inputPort(node: WorkflowNode): { x: number; y: number } {
  return { x: node.x, y: node.y + nodeHeight(node.kind) / 2 }
}

/** @returns an SVG cubic path between two canvas-space points. */
export function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = Math.max(40, Math.abs(to.x - from.x) * 0.5)
  return `M ${String(from.x)} ${String(from.y)} C ${String(from.x + dx)} ${String(from.y)}, ${String(to.x - dx)} ${String(to.y)}, ${String(to.x)} ${String(to.y)}`
}
