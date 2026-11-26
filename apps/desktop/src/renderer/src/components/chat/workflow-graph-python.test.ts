import { describe, expect, it } from 'vitest'
import { buildDag } from './workflow-dag'
import { parseWorkflowGraph } from './workflow-graph'
import { parsePythonWorkflowGraph } from './workflow-graph-python'

const ECHO_SCRIPT = `phase("Echo")
results = await parallel(
    ["Hello", "World"],
    lambda word: agent(
        f"Reply with only the uppercase version of: {word}",
        schema={"type": "string"},
        role=f"Uppercase {word}",
        model="flash_lite",
    ),
)
log("Results:", results)
`

describe('parsePythonWorkflowGraph', () => {
  it('parses phase, parallel list items, lambda param, and f-string role/prompt/model and builds concrete DAG nodes', () => {
    const graph = parseWorkflowGraph(ECHO_SCRIPT)
    expect(graph.phases).toEqual(['Echo'])
    expect(graph.blocks).toHaveLength(1)
    const block = graph.blocks[0]
    expect(block?.kind).toBe('parallel')
    if (!block || block.kind !== 'parallel') return
    expect(block.phase).toBe('Echo')
    expect(block.dynamic).toBe(true)
    expect(block.items).toEqual(['Hello', 'World'])
    expect(block.mapParams).toEqual(['word'])
    expect(block.agents).toEqual([
      {
        label: 'Uppercase ${word}',
        prompt: 'Reply with only the uppercase version of: ${word}',
        agentType: undefined,
        model: 'flash_lite',
      },
    ])

    const dag = buildDag(graph)
    expect(dag.phases).toEqual(['Echo'])
    expect(dag.nodes.map((n) => n.label)).toEqual(['Uppercase Hello', 'Uppercase World'])
    expect(dag.nodes.map((n) => n.prompt)).toEqual([
      'Reply with only the uppercase version of: Hello',
      'Reply with only the uppercase version of: World',
    ])
  })

  it('parses serial agents, pipeline stages, list variables, and async def helper callbacks', () => {
    const script = `
# phase("Ignored comment")
async def review_file(path):
    return await agent(
        f"Review {path} for bugs",
        schema={"type": "string"},
        role=f"Review {path}",
        type_name="research",
    )

files = ["a.py", "b.py"]

phase("Discover")
summary = await agent("Describe agent(fake) safely", role="Scout", model="flash")

phase("Review")
reviews = await parallel(files, review_file)

phase("Polish")
final = await pipeline(
    ["draft1", "draft2"],
    lambda item: agent(f"Edit {item}", role=f"Edit {item}"),
    lambda prev, item: agent(f"Verify {item}", role=f"Verify {item}"),
)
`
    const graph = parsePythonWorkflowGraph(script)
    expect(graph.phases).toEqual(['Discover', 'Review', 'Polish'])
    expect(graph.blocks).toHaveLength(3)

    expect(graph.blocks[0]).toEqual({
      kind: 'agent',
      phase: 'Discover',
      agent: {
        label: 'Scout',
        prompt: 'Describe agent(fake) safely',
        agentType: undefined,
        model: 'flash',
      },
    })

    const par = graph.blocks[1]
    expect(par?.kind).toBe('parallel')
    if (par?.kind === 'parallel') {
      expect(par.items).toEqual(['a.py', 'b.py'])
      expect(par.mapParams).toEqual(['path'])
      expect(par.agents).toEqual([
        {
          label: 'Review ${path}',
          prompt: 'Review ${path} for bugs',
          agentType: 'research',
          model: undefined,
        },
      ])
    }

    const pipe = graph.blocks[2]
    expect(pipe?.kind).toBe('pipeline')
    if (pipe?.kind === 'pipeline') {
      expect(pipe.items).toEqual(['draft1', 'draft2'])
      expect(pipe.stages).toBe(2)
      expect(pipe.stageItemParams).toEqual(['item', 'item'])
      expect(pipe.agents.map((a) => a.label)).toEqual(['Edit ${item}', 'Verify ${item}'])
    }

    const dag = buildDag(graph)
    expect(dag.nodes.map((n) => n.label)).toEqual([
      'Scout',
      'Review a.py',
      'Review b.py',
      'Edit draft1',
      'Edit draft2',
      'Verify draft1',
      'Verify draft2',
    ])
  })
})
