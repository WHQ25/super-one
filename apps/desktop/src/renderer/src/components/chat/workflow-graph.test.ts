import { describe, it, expect } from 'vitest'
import { parseWorkflowGraph, attachWorkflowChildren } from './workflow-graph'

const UI_TEST_MINIMAL = `export const meta = {
  name: 'ui-test-minimal',
  description: '极简演示 workflow',
  phases: [
    { title: 'Greet', detail: '单个 agent 返回一句问候' },
    { title: 'Fan-out', detail: '三个并行 agent 各报一种颜色' },
  ],
}

const COLOR_SCHEMA = { type: 'object', properties: { hex: { type: 'string' } } }

phase('Greet')
const greeting = await agent('用一句中文友好地打个招呼，不超过15字。', { label: 'greet' })
log(\`问候已生成：\${greeting}\`)

phase('Fan-out')
const colors = ['红色', '绿色', '蓝色']
const results = await parallel(
  colors.map((c, i) => () =>
    agent(\`给出颜色「\${c}」的十六进制色值。\`, { label: \`color:\${c}\`, phase: 'Fan-out', schema: COLOR_SCHEMA })
  )
)

return { greeting, colors: results.filter(Boolean) }
`

describe('parseWorkflowGraph — real ui-test-minimal script', () => {
  const graph = parseWorkflowGraph(UI_TEST_MINIMAL)

  it('handles export const meta + top-level await/return by wrapping before parse', () => {
    expect(graph.blocks.length).toBe(2)
  })

  it('extracts phases in execution order', () => {
    expect(graph.phases).toEqual(['Greet', 'Fan-out'])
  })

  it('treats the bare awaited agent as a serial agent block in its phase', () => {
    expect(graph.blocks[0]).toEqual({ kind: 'agent', phase: 'Greet', agent: { label: 'greet', prompt: '用一句中文友好地打个招呼，不超过15字。', agentType: undefined, model: undefined } })
  })

  it('treats parallel(colors.map(...)) as a dynamic parallel block with the agent label template', () => {
    const block = graph.blocks[1]
    expect(block.kind).toBe('parallel')
    if (block.kind !== 'parallel') return
    expect(block.phase).toBe('Fan-out')
    expect(block.dynamic).toBe(true)
    expect(block.agents).toHaveLength(1)
    expect(block.agents[0].label).toBe('color:${c}')
  })
})

describe('parseWorkflowGraph — orchestration primitives', () => {
  it('marks a literal parallel([...]) array as static with one node per agent', () => {
    const g = parseWorkflowGraph(`
      phase('Search')
      await parallel([
        () => agent('do a', { label: 'a' }),
        () => agent('do b', { label: 'b', agentType: 'Explore' }),
      ])
    `)
    const block = g.blocks[0]
    expect(block.kind).toBe('parallel')
    if (block.kind !== 'parallel') return
    expect(block.dynamic).toBe(false)
    expect(block.agents.map((a) => a.label)).toEqual(['a', 'b'])
    expect(block.agents[1].agentType).toBe('Explore')
  })

  it('resolves a dynamic parallel(arr.map) fan-out values + params from a const array', () => {
    const g = parseWorkflowGraph(`
      const colors = ['红', '绿', '蓝']
      await parallel(colors.map((c, i) => () => agent(\`给出\${c}\`, { label: \`color:\${c}\` })))
    `)
    const block = g.blocks[0]
    expect(block.kind).toBe('parallel')
    if (block.kind !== 'parallel') return
    expect(block.dynamic).toBe(true)
    expect(block.items).toEqual(['红', '绿', '蓝'])
    expect(block.mapParams).toEqual(['c', 'i'])
  })

  it('resolves an inline array literal passed straight to parallel(...map)', () => {
    const g = parseWorkflowGraph(`
      await parallel(['a', 'b'].map((x) => () => agent('do ' + x, { label: \`t:\${x}\` })))
    `)
    const block = g.blocks[0]
    if (block.kind !== 'parallel') return
    expect(block.items).toEqual(['a', 'b'])
    expect(block.mapParams).toEqual(['x'])
  })

  it('resolves pipeline items + per-stage item param (originalItem position varies)', () => {
    const g = parseWorkflowGraph(`
      const topics = ['太阳', '海洋']
      await pipeline(
        topics,
        (topic) => agent('g', { label: \`gen:\${topic}\` }),
        (english, topic) => agent('t', { label: \`translate:\${topic}\` }),
      )
    `)
    const block = g.blocks[0]
    if (block.kind !== 'pipeline') return
    expect(block.items).toEqual(['太阳', '海洋'])
    expect(block.stageItemParams).toEqual(['topic', 'topic'])
  })

  it('captures pipeline stage count and the agents across stages', () => {
    const g = parseWorkflowGraph(`
      const items = ['x', 'y']
      await pipeline(
        items,
        (it) => agent('review ' + it, { label: 'review' }),
        (r) => agent('verify', { label: 'verify' }),
      )
    `)
    const block = g.blocks[0]
    expect(block.kind).toBe('pipeline')
    if (block.kind !== 'pipeline') return
    expect(block.stages).toBe(2)
    expect(block.dynamic).toBe(true)
    expect(block.agents.map((a) => a.label)).toEqual(['review', 'verify'])
  })

  it('unwraps a parallel(...) buried under .filter().flatMap() method chains', () => {
    const g = parseWorkflowGraph(`
      const ANGLES = ['a', 'b']
      phase('Find')
      const found = (await parallel(ANGLES.map((x) => () => agent('do ' + x, { label: \`find:\${x}\` }))))
        .filter(Boolean)
        .flatMap((r) => r.findings || [])
    `)
    const block = g.blocks[0]
    expect(block.kind).toBe('parallel')
    if (block.kind !== 'parallel') return
    expect(block.phase).toBe('Find')
    expect(block.dynamic).toBe(true)
    expect(block.items).toEqual(['a', 'b'])
    expect(block.agents[0].label).toBe('find:${x}')
  })

  it('does not mistake a plain arr.map().join() chain for an orchestration block', () => {
    const g = parseWorkflowGraph(`
      const verified = []
      const list = verified.map((c) => c.summary).join('\\n')
    `)
    expect(g.blocks).toEqual([])
  })

  it('keeps multiple serial agents as ordered agent blocks', () => {
    const g = parseWorkflowGraph(`
      const a = await agent('first', { label: 'one' })
      const b = await agent('second', { label: 'two' })
    `)
    expect(g.blocks.map((b) => b.kind)).toEqual(['agent', 'agent'])
    expect(g.blocks.map((b) => (b.kind === 'agent' ? b.agent.label : null))).toEqual(['one', 'two'])
  })

  it('records a nested workflow() call as a workflow block', () => {
    const g = parseWorkflowGraph(`await workflow('sub-research', { topic: 'x' })`)
    expect(g.blocks[0]).toEqual({ kind: 'workflow', phase: undefined, name: 'sub-research', scriptPath: undefined })
  })

  it('resolves workflow({ scriptPath }) name + path from a const + template literal', () => {
    const g = parseWorkflowGraph(`
      const base = '/p/workflows/scripts'
      await workflow({ scriptPath: \`\${base}/ui-test-minimal-wf_2f7264c8-4e0.js\` })
    `)
    const block = g.blocks[0]
    expect(block.kind).toBe('workflow')
    if (block.kind !== 'workflow') return
    expect(block.scriptPath).toBe('/p/workflows/scripts/ui-test-minimal-wf_2f7264c8-4e0.js')
    expect(block.name).toBe('ui-test-minimal')
  })
})

describe('attachWorkflowChildren — recursive sub-workflow inlining', () => {
  const CHILD = `
    phase('Greet')
    await agent('hi', { label: 'greet' })
  `
  const PARENT = `
    const base = '/p/scripts'
    phase('Children')
    await workflow({ scriptPath: \`\${base}/child-wf_aaa.js\` })
    phase('Done')
    await agent('sum', { label: 'summarize' })
  `

  it('attaches the parsed child graph onto the workflow block by scriptPath', () => {
    const scripts = new Map([['/p/scripts/child-wf_aaa.js', CHILD]])
    const g = attachWorkflowChildren(parseWorkflowGraph(PARENT), scripts)
    const wf = g.blocks.find((b) => b.kind === 'workflow')
    expect(wf?.kind).toBe('workflow')
    if (wf?.kind !== 'workflow') return
    expect(wf.child?.blocks.map((b) => b.kind)).toEqual(['agent'])
    expect(wf.child?.phases).toEqual(['Greet'])
  })

  it('leaves the workflow block child undefined when the script is not provided', () => {
    const g = attachWorkflowChildren(parseWorkflowGraph(PARENT), new Map())
    const wf = g.blocks.find((b) => b.kind === 'workflow')
    if (wf?.kind !== 'workflow') return
    expect(wf.child).toBeUndefined()
  })

  it('guards against self-referential cycles', () => {
    const cyclic = `const base = '/p/scripts'\nawait workflow({ scriptPath: \`\${base}/child-wf_aaa.js\` })`
    const map = new Map([['/p/scripts/child-wf_aaa.js', cyclic]])
    const g = attachWorkflowChildren(parseWorkflowGraph(cyclic), map)
    const wf = g.blocks.find((b) => b.kind === 'workflow')
    if (wf?.kind !== 'workflow') return
    const childWf = wf.child?.blocks.find((b) => b.kind === 'workflow')
    expect(childWf && childWf.kind === 'workflow' ? childWf.child : undefined).toBeUndefined()
  })

  it('returns an empty graph for an unparseable script', () => {
    expect(parseWorkflowGraph('this is (not valid javascript {{{')).toEqual({ phases: [], blocks: [] })
  })
})
