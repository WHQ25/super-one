import { describe, it, expect } from 'vitest'
import { parseWorkflowGraph } from './workflow-graph'

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
    expect(graph.blocks[0]).toEqual({ kind: 'agent', phase: 'Greet', agent: { label: 'greet', agentType: undefined, model: undefined } })
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
    expect(g.blocks[0]).toEqual({ kind: 'workflow', phase: undefined, name: 'sub-research' })
  })

  it('returns an empty graph for an unparseable script', () => {
    expect(parseWorkflowGraph('this is (not valid javascript {{{')).toEqual({ phases: [], blocks: [] })
  })
})
