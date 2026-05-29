import { describe, it, expect } from 'vitest'
import { buildDag } from './workflow-dag'
import type { WorkflowGraph } from './workflow-graph'

const UI_TEST_GRAPH: WorkflowGraph = {
  phases: ['Greet', 'Fan-out'],
  blocks: [
    { kind: 'agent', phase: 'Greet', agent: { label: 'greet' } },
    { kind: 'parallel', phase: 'Fan-out', dynamic: true, agents: [{ label: 'color:${c}' }] },
  ],
}

describe('buildDag — skeleton from script only (no runtime)', () => {
  const dag = buildDag(UI_TEST_GRAPH)

  it('keeps a dynamic parallel as a single template node until runtime expands it', () => {
    expect(dag.cols).toBe(2)
    const parallelNodes = dag.nodes.filter((n) => n.group === 'parallel')
    expect(parallelNodes).toHaveLength(1)
    expect(parallelNodes[0].label).toBe('color:${c}')
    expect(parallelNodes[0].dynamic).toBe(true)
  })

  it('connects greet → parallel as a single serial edge when only one instance is known', () => {
    expect(dag.edges).toEqual([{ from: 'n0', to: 'n1-0', kind: 'serial' }])
  })
})

describe('buildDag — expanded with runtime agents', () => {
  const dag = buildDag(UI_TEST_GRAPH, [
    { label: 'color:红色', status: 'done', toolCount: 1 },
    { label: 'color:绿色', status: 'done' },
    { label: 'color:蓝色', status: 'running' },
  ])

  it('expands the dynamic parallel template into one node per matching runtime agent', () => {
    const parallel = dag.nodes.filter((n) => n.group === 'parallel')
    expect(parallel.map((n) => n.label)).toEqual(['color:红色', 'color:绿色', 'color:蓝色'])
    expect(parallel.every((n) => n.rows === 3)).toBe(true)
    expect(parallel[0].status).toBe('done')
    expect(parallel[2].status).toBe('running')
  })

  it('turns greet → 3 parallel agents into three fan-out edges', () => {
    const fanout = dag.edges.filter((e) => e.kind === 'fanout')
    expect(fanout).toHaveLength(3)
    expect(fanout.every((e) => e.from === 'n0')).toBe(true)
  })
})

describe('buildDag — fan-out then fan-in', () => {
  const graph: WorkflowGraph = {
    phases: [],
    blocks: [
      { kind: 'parallel', phase: undefined, dynamic: false, agents: [{ label: 'a' }, { label: 'b' }] },
      { kind: 'agent', phase: undefined, agent: { label: 'merge' } },
    ],
  }
  const dag = buildDag(graph)

  it('creates one node per static parallel agent', () => {
    expect(dag.nodes.filter((n) => n.group === 'parallel').map((n) => n.label)).toEqual(['a', 'b'])
  })

  it('emits fan-in edges from each parallel node into the merge agent', () => {
    const fanin = dag.edges.filter((e) => e.kind === 'fanin')
    expect(fanin).toHaveLength(2)
    expect(fanin.every((e) => e.to === 'n1')).toBe(true)
  })
})

describe('buildDag — pipeline stages become sequential columns', () => {
  const graph: WorkflowGraph = {
    phases: ['Review'],
    blocks: [
      { kind: 'pipeline', phase: 'Review', dynamic: true, stages: 2, agents: [{ label: 'review' }, { label: 'verify' }] },
    ],
  }
  const dag = buildDag(graph)

  it('lays out each stage in its own column with a serial edge between them', () => {
    const stages = dag.nodes.filter((n) => n.group === 'pipeline')
    expect(stages.map((n) => n.label)).toEqual(['review', 'verify'])
    expect(stages.map((n) => n.col)).toEqual([0, 1])
    expect(dag.edges).toEqual([{ from: 'n0', to: 'n1', kind: 'serial' }])
  })
})
