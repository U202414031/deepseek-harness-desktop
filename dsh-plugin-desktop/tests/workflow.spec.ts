import { describe, expect, it } from 'vitest'
import {
  createWorkflow,
  edgePath,
  inputPort,
  outputPort,
} from '../src/client/features/workflow/workflow-types.ts'
import {
  workflowStore,
} from '../src/client/features/workflow/workflow-store.ts'
import {
  interpolate,
  topoOrder,
} from '../src/client/features/workflow/workflow-runner.ts'

describe('workflow data model', () => {
  it('seeds a start -> agent -> end skeleton', () => {
    const wf = createWorkflow('Demo')
    expect(wf.nodes).toHaveLength(3)
    expect(wf.edges).toHaveLength(2)
    expect(wf.nodes.map((node) => node.kind)).toEqual(['start', 'agent', 'end'])
  })

  it('ports and edge path use canvas coordinates', () => {
    const node = createWorkflow('Demo').nodes[1]
    expect(outputPort(node).x).toBe(node.x + 232)
    expect(inputPort(node).x).toBe(node.x)
    expect(outputPort(node).y).toBe(inputPort(node).y)
    expect(edgePath({ x: 0, y: 0 }, { x: 100, y: 0 })).toContain('C')
  })
})

describe('workflow store', () => {
  it('creates, selects, renames, duplicates and removes workflows', () => {
    const before = workflowStore.getSnapshot().workflows.length
    const id = workflowStore.create('A')
    expect(workflowStore.getSnapshot().activeId).toBe(id)
    expect(workflowStore.getSnapshot().workflows).toHaveLength(before + 1)

    workflowStore.rename(id, 'B')
    expect(workflowStore.getSnapshot().workflows.find((w) => w.id === id)?.name).toBe('B')

    const dup = workflowStore.duplicate(id)
    expect(dup).not.toBeNull()
    expect(workflowStore.getSnapshot().workflows).toHaveLength(before + 2)

    workflowStore.remove(id)
    expect(workflowStore.getSnapshot().workflows.find((w) => w.id === id)).toBeUndefined()
    expect(workflowStore.getSnapshot().activeId).not.toBe(id)
  })

  it('refuses self-links and cycles when connecting', () => {
    const id = workflowStore.create('Cycle')
    // create() seeds a start -> agent -> end skeleton (2 edges); account for it.
    const base = workflowStore.getSnapshot().workflows.find((w) => w.id === id)!.edges.length
    const start = workflowStore.addNode(id, 'start', 0, 0)
    const agent = workflowStore.addNode(id, 'agent', 200, 0)
    const end = workflowStore.addNode(id, 'end', 400, 0)
    expect(start).not.toBeNull()
    expect(agent).not.toBeNull()
    expect(end).not.toBeNull()

    expect(workflowStore.connect(id, start!, start!)).toBe(false)
    expect(workflowStore.connect(id, start!, agent!)).toBe(true)
    expect(workflowStore.connect(id, agent!, end!)).toBe(true)
    // start->agent already exists; duplicate refused
    expect(workflowStore.connect(id, start!, agent!)).toBe(false)
    // end->start would close a cycle (start->agent->end->start); refused
    expect(workflowStore.connect(id, end!, start!)).toBe(false)

    let wf = workflowStore.getSnapshot().workflows.find((w) => w.id === id)
    expect(wf?.edges).toHaveLength(base + 2)

    // Remove the last added edge (agent -> end).
    const last = wf!.edges[wf!.edges.length - 1]
    workflowStore.disconnect(id, last.id)
    wf = workflowStore.getSnapshot().workflows.find((w) => w.id === id)
    expect(wf?.edges).toHaveLength(base + 1)
  })
})

describe('workflow runner helpers', () => {
  it('orders nodes topologically and flags cycles', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never
    const acyclic = topoOrder(nodes, [
      { id: 'e1', from: 'a', to: 'b' },
      { id: 'e2', from: 'b', to: 'c' },
    ] as never)
    expect(acyclic.cyclic).toBe(false)
    expect(acyclic.order).toEqual(['a', 'b', 'c'])

    const cyclic = topoOrder(nodes, [
      { id: 'e1', from: 'a', to: 'b' },
      { id: 'e2', from: 'b', to: 'a' },
    ] as never)
    expect(cyclic.cyclic).toBe(true)
  })

  it('substitutes {{vars}} but leaves unknown placeholders intact', () => {
    expect(interpolate('hi {{name}}', new Map([['name', 'Ada']]))).toBe('hi Ada')
    expect(interpolate('{{missing}}', new Map())).toBe('{{missing}}')
    expect(interpolate('{{ a }} {{ b }}', new Map([['a', '1']]))).toBe('1 {{ b }}')
  })
})
