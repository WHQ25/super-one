import { describe, it, expect } from 'vitest'
import { buildDag, agentPhaseByPrompt, promptMatchesTemplate, assignAgentsToNodes, measureDag, layoutDag } from './workflow-dag'
import { parseWorkflowGraph, type WorkflowGraph } from './workflow-graph'

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

describe('buildDag — static fan-out expansion from script array', () => {
  const graph: WorkflowGraph = {
    phases: ['Fan-out'],
    blocks: [
      { kind: 'agent', phase: 'Greet', agent: { label: 'greet' } },
      { kind: 'parallel', phase: 'Fan-out', dynamic: true, items: ['红', '绿', '蓝'], mapParams: ['c', 'i'], agents: [{ label: 'color:${c}' }] },
    ],
  }
  const dag = buildDag(graph)

  it('expands the template into one concrete node per array element without runtime', () => {
    const nodes = dag.nodes.filter((n) => n.group === 'parallel')
    expect(nodes.map((n) => n.label)).toEqual(['color:红', 'color:绿', 'color:蓝'])
    expect(nodes.every((n) => n.rows === 3)).toBe(true)
  })

  it('marks statically-expanded nodes as non-dynamic since the count is known', () => {
    expect(dag.nodes.every((n) => !n.dynamic)).toBe(true)
  })

  it('connects greet → each expanded node as a fan-out edge', () => {
    expect(dag.edges.filter((e) => e.kind === 'fanout')).toHaveLength(3)
  })
})

describe('node prompt correlation (clicking a node finds its agent)', () => {
  const graph: WorkflowGraph = {
    phases: ['Fan-out'],
    blocks: [
      {
        kind: 'parallel',
        phase: 'Fan-out',
        dynamic: true,
        items: ['红', '绿'],
        mapParams: ['c', 'i'],
        agents: [{ label: 'color:${c}', prompt: '给出颜色「${c}」的色值' }],
      },
    ],
  }
  const dag = buildDag(graph)

  it('carries the expanded prompt on each node, not just the label', () => {
    expect(dag.nodes.map((n) => n.prompt)).toEqual(['给出颜色「红」的色值', '给出颜色「绿」的色值'])
  })

  it('links a node back to the actual agent prompt via promptMatchesTemplate', () => {
    const node = dag.nodes.find((n) => n.label === 'color:红')!
    expect(promptMatchesTemplate(node.prompt, '给出颜色「红」的色值')).toBe(true)
    expect(promptMatchesTemplate(node.prompt, '给出颜色「蓝」的色值')).toBe(false)
  })
})

describe('assignAgentsToNodes — 1:1 node↔agent (no whole-column collision)', () => {
  it('gives each node a distinct agent even when downstream prompts share a template', () => {
    const nodes = [
      { id: 'tr-0', prompt: 'Translate this: "${english}"' },
      { id: 'tr-1', prompt: 'Translate this: "${english}"' },
    ]
    const agents = [
      { agentId: 'x', prompt: 'Translate this: "the sun"' },
      { agentId: 'y', prompt: 'Translate this: "the sea"' },
    ]
    const map = assignAgentsToNodes(nodes, agents)
    expect(new Set(map.values()).size).toBe(2)
    expect(map.has('tr-0')).toBe(true)
    expect(map.has('tr-1')).toBe(true)
  })

  it('prefers exact prompt matches before consuming agents for loose ones', () => {
    const nodes = [
      { id: 'loose', prompt: 'about "${topic}"' },
      { id: 'exact', prompt: 'about "太阳"' },
    ]
    const agents = [
      { agentId: 'sun', prompt: 'about "太阳"' },
      { agentId: 'sea', prompt: 'about "海洋"' },
    ]
    const map = assignAgentsToNodes(nodes, agents)
    expect(map.get('exact')).toBe('sun')
    expect(map.get('loose')).toBe('sea')
  })

  it('skips nodes without a prompt', () => {
    const map = assignAgentsToNodes([{ id: 'wf', prompt: undefined }], [{ agentId: 'a', prompt: 'x' }])
    expect(map.size).toBe(0)
  })
})

describe('promptMatchesTemplate — template vs actual prompt', () => {
  it('matches a literal prompt exactly', () => {
    expect(promptMatchesTemplate('打个招呼', '打个招呼')).toBe(true)
  })

  it('matches via wildcard when the template has unresolved expressions', () => {
    expect(promptMatchesTemplate('总结：${minimal.greeting}', '总结：你好')).toBe(true)
  })

  it('returns false on missing inputs', () => {
    expect(promptMatchesTemplate(undefined, 'x')).toBe(false)
    expect(promptMatchesTemplate('x', undefined)).toBe(false)
  })
})

describe('measureDag / layoutDag — canvas geometry', () => {
  const dag = buildDag({
    phases: [],
    blocks: [
      { kind: 'agent', phase: undefined, agent: { label: 'a' } },
      { kind: 'parallel', phase: undefined, dynamic: false, agents: [{ label: 'b' }, { label: 'c' }] },
    ],
  })

  it('grows width with columns and height with the widest parallel band', () => {
    const { width, height } = measureDag(dag)
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
    const single = measureDag(buildDag({ phases: [], blocks: [{ kind: 'agent', phase: undefined, agent: { label: 'only' } }] }))
    expect(width).toBeGreaterThan(single.width)
    expect(height).toBeGreaterThan(single.height)
  })

  it('exposes per-node positions for canvas anchoring', () => {
    const layout = layoutDag(dag)
    expect(layout.pos.get('n0')).toBeDefined()
    expect(layout.pos.get('n1-0')!.x).toBeGreaterThan(layout.pos.get('n0')!.x)
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

describe('buildDag — pipeline static grid from items × stages', () => {
  const graph: WorkflowGraph = {
    phases: ['Generate', 'Translate'],
    blocks: [
      { kind: 'agent', phase: 'Seed', agent: { label: 'seed' } },
      {
        kind: 'pipeline',
        phase: 'Generate',
        dynamic: true,
        stages: 2,
        items: ['太阳', '海洋'],
        stageItemParams: ['topic', 'topic'],
        agents: [{ label: 'gen:${topic}' }, { label: 'translate:${topic}' }],
      },
    ],
  }
  const dag = buildDag(graph)
  const pipe = () => dag.nodes.filter((n) => n.group === 'pipeline')
  const byLabel = (l: string) => dag.nodes.find((n) => n.label === l)!

  it('creates one node per item per stage', () => {
    expect(pipe().map((n) => n.label).sort()).toEqual(['gen:太阳', 'gen:海洋', 'translate:太阳', 'translate:海洋'].sort())
    expect(pipe().every((n) => n.rows === 2 && !n.dynamic)).toBe(true)
  })

  it('places stages in adjacent columns and items in rows', () => {
    expect(byLabel('translate:太阳').col).toBe(byLabel('gen:太阳').col + 1)
    expect(byLabel('gen:太阳').row).not.toBe(byLabel('gen:海洋').row)
  })

  it('chains each item through its own stages serially (same row)', () => {
    expect(dag.edges).toContainEqual({ from: byLabel('gen:太阳').id, to: byLabel('translate:太阳').id, kind: 'serial' })
    expect(dag.edges).toContainEqual({ from: byLabel('gen:海洋').id, to: byLabel('translate:海洋').id, kind: 'serial' })
  })

  it('fans out from the upstream agent into every item row at the first stage', () => {
    const fanout = dag.edges.filter((e) => e.kind === 'fanout' && e.from === byLabel('seed').id)
    expect(fanout.map((e) => e.to).sort()).toEqual([byLabel('gen:太阳').id, byLabel('gen:海洋').id].sort())
  })
})

describe('agentPhaseByPrompt — match a runtime prompt to its script phase', () => {
  const graph = parseWorkflowGraph(`
    phase('Greet')
    await agent('用一句中文友好地打个招呼，不超过15字。', { label: 'greet' })
    phase('Fan-out')
    const colors = ['红色', '绿色']
    await parallel(colors.map((c) => () => agent(\`给出颜色「\${c}」的十六进制色值。\`, { label: \`color:\${c}\` })))
  `)

  it('matches a literal prompt to its phase', () => {
    expect(agentPhaseByPrompt(graph, '用一句中文友好地打个招呼，不超过15字。')).toBe('Greet')
  })

  it('matches a templated prompt instance to its phase via the ${} wildcard', () => {
    expect(agentPhaseByPrompt(graph, '给出颜色「红色」的十六进制色值。')).toBe('Fan-out')
    expect(agentPhaseByPrompt(graph, '给出颜色「蓝色」的十六进制色值。')).toBe('Fan-out')
  })

  it('returns undefined for a prompt that matches no agent', () => {
    expect(agentPhaseByPrompt(graph, '完全无关的内容')).toBeUndefined()
  })
})

describe('buildDag — sub-workflow inlining', () => {
  const graph: WorkflowGraph = {
    phases: ['Children', 'Done'],
    blocks: [
      {
        kind: 'workflow',
        phase: 'Children',
        name: 'child-mini',
        scriptPath: '/p/child.js',
        child: {
          phases: ['Greet'],
          blocks: [
            { kind: 'agent', phase: 'Greet', agent: { label: 'greet' } },
            { kind: 'parallel', phase: 'Greet', dynamic: false, agents: [{ label: 'a' }, { label: 'b' }] },
          ],
        },
      },
      { kind: 'agent', phase: 'Done', agent: { label: 'summarize' } },
    ],
  }
  const dag = buildDag(graph)

  it('expands a resolved child workflow inline instead of a single workflow node', () => {
    expect(dag.nodes.find((n) => n.group === 'workflow')).toBeUndefined()
    expect(dag.nodes.map((n) => n.label)).toEqual(['greet', 'a', 'b', 'summarize'])
  })

  it('tags every inlined child node with the sub-workflow name', () => {
    const tagged = dag.nodes.filter((n) => n.subworkflow === 'child-mini')
    expect(tagged.map((n) => n.label)).toEqual(['greet', 'a', 'b'])
    expect(dag.nodes.find((n) => n.label === 'summarize')?.subworkflow).toBeUndefined()
  })

  it('keeps the parent serial flow connected through the child (child exit → summarize)', () => {
    expect(dag.edges).toContainEqual({ from: 'n1-0', to: 'n2', kind: 'fanin' })
    expect(dag.edges).toContainEqual({ from: 'n1-1', to: 'n2', kind: 'fanin' })
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
