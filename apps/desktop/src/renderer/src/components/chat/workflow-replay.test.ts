import { describe, it, expect } from 'vitest'
import { replayWorkflowDag, type ReplayAgentRecord } from './workflow-replay'

const SCRIPT = `export const meta = { name: 'r', description: 'd', phases: [] }
const CONTEXT = 'CTX'
const ANGLES = [{ key: 'A' }, { key: 'B' }]
phase('Find')
const found = (await parallel(ANGLES.map((a) => () =>
  agent(\`\${CONTEXT} find \${a.key}\`, { label: \`find:\${a.key}\` })
))).filter(Boolean).flatMap((r) => r.findings || [])
const seen = new Set()
const candidates = []
for (const c of found) {
  const k = \`\${c.file}:\${c.line}\`
  if (seen.has(k)) continue
  seen.add(k)
  candidates.push(c)
}
phase('Verify')
const verified = (await parallel(candidates.map((c) => () =>
  agent(\`\${CONTEXT} verify \${c.file}:\${c.line}\`, { label: \`verify:\${c.file.split('/').pop()}:\${c.line}\` })
    .then((v) => ({ ...c, verdict: v && v.verdict }))
))).filter(Boolean).filter((c) => c.verdict !== 'REFUTED')
phase('Sweep')
const sweep = await agent(\`\${CONTEXT} sweep\`, { label: 'sweep' })
return { verified, sweep }
`

function rec(prompt: string, agentId: string, result?: unknown): ReplayAgentRecord {
  return { agentId, prompt, result }
}

describe('replayWorkflowDag', () => {
  it('reconstructs data-dependent fan-out with real labels from recorded results', async () => {
    const records: ReplayAgentRecord[] = [
      rec('CTX find A', 'id-fa', { findings: [{ file: 'a/markdown-codec.ts', line: 42 }, { file: 'a/MarkdownEditor.tsx', line: 88 }] }),
      rec('CTX find B', 'id-fb', { findings: [{ file: 'a/math.ts', line: 10 }] }),
      rec('CTX verify a/markdown-codec.ts:42', 'id-v1', { verdict: 'CONFIRMED' }),
      rec('CTX verify a/MarkdownEditor.tsx:88', 'id-v2', { verdict: 'REFUTED' }),
      rec('CTX verify a/math.ts:10', 'id-v3', { verdict: 'PLAUSIBLE' }),
      rec('CTX sweep', 'id-sweep', { findings: [] }),
    ]
    const out = await replayWorkflowDag(SCRIPT, records)
    expect(out).not.toBeNull()
    if (!out) return
    const { dag, nodeAgentIds } = out

    const byCol: Record<number, string[]> = {}
    for (const n of dag.nodes) (byCol[n.col] ||= []).push(n.label)

    expect(byCol[0]).toEqual(['find:A', 'find:B'])
    expect(byCol[1]).toEqual([
      'verify:markdown-codec.ts:42',
      'verify:MarkdownEditor.tsx:88',
      'verify:math.ts:10',
    ])
    expect(byCol[2]).toEqual(['sweep'])

    const verifyNode = dag.nodes.find((n) => n.label === 'verify:markdown-codec.ts:42')!
    expect(nodeAgentIds.get(verifyNode.id)).toBe('id-v1')

    // verify(3) -> sweep(1) is a fan-in; find(2) -> verify(3) is many-to-many (serial edges)
    expect(dag.edges.some((e) => e.kind === 'fanin')).toBe(true)
    expect(dag.edges.length).toBeGreaterThan(0)
  })

  it('aborts an unbounded agent loop at the call cap instead of hanging', async () => {
    const loopScript = `let i = 0\nwhile (true) { await agent('x ' + i, { label: 'a' + i }); i++ }`
    const out = await replayWorkflowDag(loopScript, [])
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.dag.nodes.length).toBeLessThanOrEqual(5000)
    expect(out.dag.nodes.length).toBeGreaterThan(100)
  }, 15000)

  it('keeps a declared phase that spawned zero agents as an empty placeholder', async () => {
    const script = `phase('Find')
const found = (await parallel([() => agent('find one', { label: 'find:1' })])).filter(Boolean)
const sweep = await agent('sweep', { label: 'sweep' })
const sweepCandidates = (sweep && sweep.findings) || []
phase('VerifySweep')
const done = (await parallel(sweepCandidates.map((c) => () => agent('v ' + c.line, { label: 'vsweep' })))).filter(Boolean)`
    const out = await replayWorkflowDag(script, [
      { agentId: 'f', prompt: 'find one', result: { findings: [] } },
      { agentId: 's', prompt: 'sweep', result: {} },
    ])
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.dag.phases).toContain('VerifySweep')
    expect(out.dag.nodes.some((n) => n.phase === 'VerifySweep')).toBe(false)
  })

  it('recursively replays a sub-workflow, tags its agents, and flows its return value to the parent', async () => {
    const childPath = '/p/scripts/greeter-wf_abc.js'
    const child = `phase('Greet')
const hi = await agent('say hi', { label: 'greet' })
return { greeting: hi }`
    const parent = `phase('Children')
const r = await workflow({ scriptPath: '${childPath}' })
phase('Summarize')
const s = await agent('summarize ' + r.greeting, { label: 'summarize' })`
    const records: ReplayAgentRecord[] = [
      { agentId: 'g', prompt: 'say hi', result: '你好' },
      { agentId: 'sum', prompt: 'summarize 你好', result: 'done' },
    ]
    const out = await replayWorkflowDag(parent, records, new Map([[childPath, { source: child, name: 'greeter' }]]))
    expect(out).not.toBeNull()
    if (!out) return
    const greet = out.dag.nodes.find((n) => n.label === 'greet')!
    expect(greet.subworkflow).toBe('greeter')
    expect(greet.phase).toBe('Greet')
    // parent summarize ran with the child's real return value (prompt matched -> mapped)
    const summarize = out.dag.nodes.find((n) => n.label === 'summarize')!
    expect(summarize.subworkflow).toBeUndefined()
    expect(out.nodeAgentIds.get(summarize.id)).toBe('sum')
  })

  it('returns null when the script cannot be executed', async () => {
    expect(await replayWorkflowDag('this is (not valid {{{', [])).toBeNull()
  })

  it('tolerates a missing recorded result mid-flow', async () => {
    const records: ReplayAgentRecord[] = [
      rec('CTX find A', 'id-fa', { findings: [{ file: 'a/x.ts', line: 1 }] }),
      rec('CTX find B', 'id-fb', { findings: [] }),
      // verify result for x.ts:1 is absent -> agent returns undefined, node still recorded
      rec('CTX sweep', 'id-sweep', {}),
    ]
    const out = await replayWorkflowDag(SCRIPT, records)
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.dag.nodes.some((n) => n.label === 'verify:x.ts:1')).toBe(true)
  })
})
