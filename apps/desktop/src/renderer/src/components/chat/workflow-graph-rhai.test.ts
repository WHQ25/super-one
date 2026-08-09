import { describe, it, expect } from 'vitest'
import { looksLikeRhaiWorkflow, parseRhaiWorkflowGraph } from './workflow-graph-rhai'
import { parseWorkflowGraph } from './workflow-graph'

const SAMPLE = `
let meta = #{
    name: "demo",
    description: "demo workflow",
    phases: [
        #{ title: "Ingest", detail: "parse" },
        #{ title: "Scan", detail: "fan-out" },
        #{ title: "Report", detail: "summarize" },
    ],
};

phase("Ingest");
let ing = agent(ingest_prompt, #{
    label: "ingest-report",
    capability_mode: "read-only",
});

phase("Scan");
let scan_jobs = [];
for d in dims {
    scan_jobs.push(#{
        prompt: p,
        label: "scan:" + d.id,
        capability_mode: "read-only",
    });
}
let scan_results = parallel(scan_jobs);

phase("Report");
let report_r = agent(report_prompt, #{ label: "write-report" });
`

describe('looksLikeRhaiWorkflow', () => {
  it('detects #{ maps and let meta', () => {
    expect(looksLikeRhaiWorkflow(SAMPLE)).toBe(true)
    expect(looksLikeRhaiWorkflow(`export const meta = { name: 'x' }\nphase('A')`)).toBe(false)
  })
})

describe('parseRhaiWorkflowGraph', () => {
  const graph = parseRhaiWorkflowGraph(SAMPLE)

  it('extracts phases in order', () => {
    expect(graph.phases).toEqual(['Ingest', 'Scan', 'Report'])
  })

  it('records serial agent blocks with labels', () => {
    const agents = graph.blocks.filter((b) => b.kind === 'agent')
    expect(agents).toHaveLength(2)
    expect(agents[0]).toMatchObject({ kind: 'agent', phase: 'Ingest', agent: { label: 'ingest-report' } })
    expect(agents[1]).toMatchObject({ kind: 'agent', phase: 'Report', agent: { label: 'write-report' } })
  })

  it('records parallel as dynamic and harvests job labels from prior push maps', () => {
    const par = graph.blocks.find((b) => b.kind === 'parallel')
    expect(par).toBeDefined()
    if (!par || par.kind !== 'parallel') return
    expect(par.phase).toBe('Scan')
    expect(par.dynamic).toBe(true)
    expect(par.agents.map((a) => a.label)).toEqual(['scan:*'])
  })

  it('is reachable via parseWorkflowGraph for Rhai sources', () => {
    const via = parseWorkflowGraph(SAMPLE)
    expect(via.phases).toEqual(graph.phases)
    expect(via.blocks.length).toBe(graph.blocks.length)
  })
})

describe('parseRhaiWorkflowGraph — nested agent inside parallel', () => {
  it('collects agent() specs inside parallel args without duplicating as top-level', () => {
    const src = `
phase("Fan");
let r = parallel([
  agent("a", #{ label: "one" }),
  agent("b", #{ label: "two" }),
]);
`
    const g = parseRhaiWorkflowGraph(src)
    expect(g.blocks).toHaveLength(1)
    expect(g.blocks[0]).toMatchObject({ kind: 'parallel', phase: 'Fan' })
    if (g.blocks[0]?.kind !== 'parallel') return
    expect(g.blocks[0].agents.map((a) => a.label)).toEqual(['one', 'two'])
  })
})

describe('parseRhaiWorkflowGraph — ignore agent ( inside strings', () => {
  it('does not treat prose like "xai-grok-agent (acp_agent)" as an agent call', () => {
    const src = `
phase("Catalog");
let note = "xai-grok-agent (acp_agent, session_config), agent-mode docs";
let r = parallel(jobs);
phase("Done");
let fin = agent(p, #{ label: "fin" });
`
    const g = parseRhaiWorkflowGraph(src)
    const agents = g.blocks.filter((b) => b.kind === 'agent')
    expect(agents).toHaveLength(1)
    expect(agents[0]).toMatchObject({ phase: 'Done', agent: { label: 'fin' } })
  })
})

describe('parseRhaiWorkflowGraph — https:// URLs are not comments', () => {
  it('keeps phase() after a https URL string', () => {
    const src = `
let clone_url = "https://github.com/xai-org/grok-build.git";
phase("Source");
let source_r = agent(p, #{ label: "ensure-source" });
phase("Catalog");
let r = parallel(jobs);
`
    const g = parseRhaiWorkflowGraph(src)
    expect(g.phases).toEqual(['Source', 'Catalog'])
    expect(g.blocks.filter((b) => b.kind === 'agent')).toHaveLength(1)
  })
})
