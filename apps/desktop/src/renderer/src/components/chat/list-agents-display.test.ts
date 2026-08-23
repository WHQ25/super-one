import { describe, expect, it } from 'vitest'
import { agentGroupCounts, parseListAgents } from './list-agents-display'

/** Captured verbatim from a real `ListAgents` call — spacing included. */
const ROSTER = [
  'Subagents (1):',
  '  ac52c0c00c38676d3  ·  Plan  ·  running  ·  started 3m ago',
  '',
  'Peer sessions (2):',
  '  super-one-9c [205b72]  ·  interactive  ·  started 11m ago',
  '  super-one-80 [d6563f]  ·  interactive  ·  started 14m ago',
].join('\n')

describe('parseListAgents', () => {
  it('splits a real roster into groups and rows', () => {
    const info = parseListAgents(ROSTER)

    expect(info.total).toBe(3)
    expect(info.empty).toBe(false)
    expect(info.unstructured).toBe(false)
    expect(info.groups.map((g) => [g.kind, g.title, g.declaredCount, g.agents.length])).toEqual([
      ['subagents', 'Subagents', 1, 1],
      ['peers', 'Peer sessions', 2, 2],
    ])
  })

  it('reads the subagent row as address, type, status and age', () => {
    const [agent] = parseListAgents(ROSTER).groups[0].agents

    expect(agent).toEqual({
      name: 'ac52c0c00c38676d3',
      ref: undefined,
      descriptors: ['Plan', 'running'],
      status: 'running',
      age: 'started 3m ago',
    })
  })

  it('peels the bracketed ref off the address', () => {
    const [peer] = parseListAgents(ROSTER).groups[1].agents

    expect(peer.name).toBe('super-one-9c')
    expect(peer.ref).toBe('205b72')
    expect(peer.status).toBe('idle')
    expect(peer.age).toBe('started 11m ago')
  })

  it('maps the bridge wording onto a waiting status', () => {
    const info = parseListAgents([
      'Other Claude sessions (2):',
      '  untitled session  ·  ~/dev/app  ·  waiting on a human  ·  started 2h ago',
      '  stale one  ·  (unknown directory)  ·  offline  ·  started 3d ago',
    ].join('\n'))

    expect(info.groups[0].kind).toBe('others')
    expect(info.groups[0].agents.map((a) => a.status)).toEqual(['waiting', 'offline'])
  })

  it('keeps the declared count when the harness truncates the rows', () => {
    const info = parseListAgents(['Peer sessions (9):', '  only-one  ·  interactive'].join('\n'))

    expect(info.groups[0].declaredCount).toBe(9)
    expect(info.groups[0].agents).toHaveLength(1)
    expect(agentGroupCounts(info)).toEqual([{ kind: 'peers', title: 'Peer sessions', count: 9 }])
  })

  it('reports an empty roster as a note, not as a broken parse', () => {
    const info = parseListAgents('No subagents or other Claude sessions.')

    expect(info.empty).toBe(true)
    expect(info.unstructured).toBe(true)
    expect(info.notes).toEqual(['No subagents or other Claude sessions.'])
  })

  it('keeps an unindented trailing line out of the group above it', () => {
    const info = parseListAgents([
      'Peer sessions (1):',
      '  super-one-9c  ·  interactive',
      'Some sessions were not reachable.',
    ].join('\n'))

    expect(info.groups[0].agents).toHaveLength(1)
    expect(info.notes).toEqual(['Some sessions were not reachable.'])
  })

  it('survives a format it has never seen', () => {
    const info = parseListAgents('{"agents":[]}')

    expect(info.unstructured).toBe(true)
    expect(info.raw).toBe('{"agents":[]}')
    expect(info.groups).toEqual([])
  })

  it('treats a missing result as nothing to show', () => {
    const info = parseListAgents(undefined)

    expect(info).toMatchObject({ total: 0, empty: true, unstructured: true, notes: [], raw: '' })
    expect(agentGroupCounts(info)).toEqual([])
  })

  it('tolerates a heading without a count', () => {
    const info = parseListAgents(['Subagents:', '  worker-1  ·  running'].join('\n'))

    expect(info.groups[0]).toMatchObject({ kind: 'subagents', declaredCount: undefined })
    expect(info.groups[0].agents[0].name).toBe('worker-1')
  })

  it('keeps a single-field row that carries only an address', () => {
    const info = parseListAgents(['Subagents (1):', '  lonely-worker'].join('\n'))

    expect(info.groups[0].agents[0]).toMatchObject({
      name: 'lonely-worker',
      descriptors: [],
      status: 'unknown',
      age: undefined,
    })
  })
})
