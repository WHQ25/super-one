import { describe, it, expect } from 'vitest'
import { buildDag, agentPhaseByPrompt, promptMatchesTemplate, assignAgentsToNodes, measureDag, layoutDag, type Dag } from './workflow-dag'
import { parseWorkflowGraph, type WorkflowGraph } from './workflow-graph'

describe('layoutDag — phase clusters with grid layout', () => {
  const dag: Dag = {
    cols: 3,
    nodes: [
      { id: 'f0', label: 'find:A', phase: 'Find', group: 'parallel', col: 0, row: 0, rows: 2 },
      { id: 'f1', label: 'find:B', phase: 'Find', group: 'parallel', col: 0, row: 1, rows: 2 },
      { id: 'v0', label: 'verify:x', phase: 'Verify', group: 'parallel', col: 1, row: 0, rows: 3 },
      { id: 'v1', label: 'verify:y', phase: 'Verify', group: 'parallel', col: 1, row: 1, rows: 3 },
      { id: 'v2', label: 'verify:z', phase: 'Verify', group: 'parallel', col: 1, row: 2, rows: 3 },
      { id: 's', label: 'sweep', phase: 'Sweep', group: 'serial', col: 2, row: 0, rows: 1 },
    ],
    edges: [],
  }

  it('groups nodes into one cluster per phase, ordered left to right', () => {
    const { clusters } = layoutDag(dag)
    expect(clusters.map((c) => c.label)).toEqual(['Find', 'Verify', 'Sweep'])
    expect(clusters.map((c) => c.count)).toEqual([2, 3, 1])
    expect(clusters[1].x).toBeGreaterThanOrEqual(clusters[0].x + clusters[0].w)
    expect(clusters[2].x).toBeGreaterThanOrEqual(clusters[1].x + clusters[1].w)
  })

  it('renders a placeholder cluster for a declared phase with zero nodes', () => {
    const withEmptyPhase: Dag = { ...dag, phases: ['Find', 'Verify', 'Sweep', 'VerifySweep'] }
    const { clusters } = layoutDag(withEmptyPhase)
    expect(clusters.map((c) => c.label)).toEqual(['Find', 'Verify', 'Sweep', 'VerifySweep'])
    const vsweep = clusters.find((c) => c.label === 'VerifySweep')!
    expect(vsweep.count).toBe(0)
    expect(vsweep.x).toBeGreaterThanOrEqual(clusters[2].x + clusters[2].w)
  })

  it('lays a multi-agent cluster out as a grid, not a single tall column', () => {
    const { pos } = layoutDag(dag)
    const v0 = pos.get('v0')!
    const v1 = pos.get('v1')!
    const v2 = pos.get('v2')!
    // 3 nodes -> ceil(sqrt(3))=2 columns: v0,v1 share a row; v2 wraps below v0
    expect(v1.x).toBeGreaterThan(v0.x)
    expect(v1.y).toBe(v0.y)
    expect(v2.y).toBeGreaterThan(v0.y)
    expect(v2.x).toBe(v0.x)
  })
})

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
      { kind: 'parallel', phase: undefined, dynamic: false, agents: [{ label: 'b' }, { label: 'c' }, { label: 'd' }, { label: 'e' }, { label: 'f' }] },
    ],
  })

  it('grows width with clusters and height with a wrapping multi-row grid cluster', () => {
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

describe('buildDag — dynamic parallel whose label is not a static template (one node per agent)', () => {
  const COMMON = '审查范围 diff 在 /tmp/cr/code.diff。最多 8 条。'
  const graph: WorkflowGraph = {
    phases: ['Find', 'Verify'],
    blocks: [
      { kind: 'parallel', phase: 'Find', dynamic: true, agents: [{ prompt: '${COMMON}\n\n【角度 ${a.key}】${a.instr}' }] },
      { kind: 'parallel', phase: 'Verify', dynamic: true, agents: [{ prompt: '${COMMON}\n\n【验证】file: ${c.file}' }] },
    ],
  }
  const runtime = [
    { label: COMMON.slice(0, 80), prompt: `${COMMON}\n\n【角度 A-line-scan】逐 hunk 逐行扫描，找反转条件、off-by-one、漏 await。`, toolCount: 1, agentId: '1' },
    { label: COMMON.slice(0, 80), prompt: `${COMMON}\n\n【角度 B-removed】被删 guard 在新代码哪重建。`, toolCount: 2, agentId: '2' },
    { label: COMMON.slice(0, 80), prompt: `${COMMON}\n\n【角度 C-cross】Grep 调用方检查破坏。`, toolCount: 3, agentId: '3' },
    { label: COMMON.slice(0, 80), prompt: `${COMMON}\n\n【验证】file: src/a.ts`, toolCount: 4, agentId: '4' },
    { label: COMMON.slice(0, 80), prompt: `${COMMON}\n\n【验证】file: src/b.ts`, toolCount: 5, agentId: '5' },
  ]
  const dag = buildDag(graph, runtime)

  it('expands each parallel to one node per runtime agent instead of collapsing to a single template node', () => {
    expect(dag.nodes.filter((n) => n.phase === 'Find')).toHaveLength(3)
    expect(dag.nodes.filter((n) => n.phase === 'Verify')).toHaveLength(2)
    expect(dag.nodes).toHaveLength(5)
  })

  it('carries each agent real prompt and toolCount onto its node (for node↔transcript linking)', () => {
    const find = dag.nodes.filter((n) => n.phase === 'Find')
    expect(find.map((n) => n.prompt)).toEqual([runtime[0].prompt, runtime[1].prompt, runtime[2].prompt])
    expect(find.map((n) => n.toolCount)).toEqual([1, 2, 3])
  })

  it('labels nodes from the shortest distinguishing prompt segment, not the shared COMMON prefix', () => {
    expect(dag.nodes.filter((n) => n.phase === 'Find').map((n) => n.label)).toEqual(['A-line-scan', 'B-removed', 'C-cross'])
    expect(dag.nodes.filter((n) => n.phase === 'Verify').map((n) => n.label)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('does not let a later block steal agents already consumed by an earlier block', () => {
    const ids = dag.nodes.map((n) => n.toolCount)
    expect(new Set(ids).size).toBe(5)
  })
})

describe('buildDag — single agent matched to runtime by prompt template when label is unreliable', () => {
  const COMMON = '审查范围……'
  const graph: WorkflowGraph = {
    phases: ['Sweep'],
    blocks: [{ kind: 'agent', phase: 'Sweep', agent: { label: 'sweep', prompt: '${COMMON}\n\n你是 fresh reviewer。' } }],
  }
  const dag = buildDag(graph, [
    { label: COMMON.slice(0, 80), prompt: `${COMMON}\n\n你是 fresh reviewer。`, toolCount: 9, agentId: 's' },
  ])

  it('matches the runtime agent by prompt template even though its derived label differs', () => {
    expect(dag.nodes).toHaveLength(1)
    expect(dag.nodes[0].toolCount).toBe(9)
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

describe('buildDag — AST static expansion of parallel(objectArray.map(...)) (real labels, no runtime)', () => {
  const SCRIPT = `
    export const meta = { name: 'cr', description: 'x', phases: [] }
    const DIFF = '/tmp/cr/code.diff'
    const COMMON = \`审查 diff 在 \${DIFF}。\`
    const ANGLES = [
      { key: 'A-line-scan', instr: '逐行扫描。' },
      { key: 'B-removed', instr: '被删 guard。' },
      { key: 'C-cross', instr: '跨文件。' },
    ]
    phase('Find')
    const r = await parallel(ANGLES.map((a) => () =>
      agent(\`\${COMMON}\\n\\n【角度 \${a.key}】\${a.instr}\`, { label: a.key, phase: 'Find', schema: {} })
    ))
    const deduped = []
    phase('Verify')
    const v = await parallel(deduped.map((c) => () =>
      agent(\`\${COMMON}\\n\\n【验证】file: \${c.file}\`, { label: 'v', phase: 'Verify', schema: {} })
    ))
  `
  const graph = parseWorkflowGraph(SCRIPT)
  const dag = buildDag(graph)

  it('expands the object-array fanout to one node per element using the real ${a.key} label', () => {
    expect(dag.nodes.filter((n) => n.phase === 'Find').map((n) => n.label)).toEqual(['A-line-scan', 'B-removed', 'C-cross'])
  })

  it('marks statically-expanded nodes non-dynamic and substitutes ${a.key}/${a.instr} into the prompt', () => {
    const a = dag.nodes.find((n) => n.label === 'A-line-scan')!
    expect(a.dynamic).toBeFalsy()
    expect(a.prompt).toContain('【角度 A-line-scan】逐行扫描。')
  })

  it('resolves top-level string/template consts (COMMON→DIFF) so the prompt has no leftover placeholders', () => {
    const a = dag.nodes.find((n) => n.label === 'A-line-scan')!
    expect(a.prompt).toContain('/tmp/cr/code.diff')
    expect(a.prompt).not.toContain('${')
  })

  it('leaves a data-dependent fanout (deduped.map) as a single placeholder node when there is no runtime', () => {
    expect(dag.nodes.filter((n) => n.phase === 'Verify')).toHaveLength(1)
  })
})

describe('buildDag — static expansion decorated by runtime status/toolCount', () => {
  const graph: WorkflowGraph = {
    phases: ['Find'],
    blocks: [
      {
        kind: 'parallel', phase: 'Find', dynamic: true, mapParams: ['a', 'i'],
        items: [{ key: 'A' }, { key: 'B' }],
        agents: [{ label: '${a.key}', prompt: 'review ${a.key}' }],
      },
    ],
  }
  const dag = buildDag(graph, [
    { label: 'whatever', prompt: 'review B', toolCount: 7, status: 'done', agentId: '2' },
    { label: 'whatever', prompt: 'review A', toolCount: 3, status: 'running', agentId: '1' },
  ])

  it('keeps AST-derived labels while pulling status/toolCount from the matching runtime agent', () => {
    const a = dag.nodes.find((n) => n.label === 'A')!
    const b = dag.nodes.find((n) => n.label === 'B')!
    expect(a.toolCount).toBe(3)
    expect(a.status).toBe('running')
    expect(b.toolCount).toBe(7)
    expect(b.status).toBe('done')
  })
})
