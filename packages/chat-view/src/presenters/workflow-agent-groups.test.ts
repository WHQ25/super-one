import { describe, expect, it } from 'vitest'
import { groupWorkflowAgents, workflowAgentTileStatus } from './workflow-utils'

describe('workflowAgentTileStatus', () => {
  it('maps lifecycle states while the run is open', () => {
    expect(workflowAgentTileStatus('completed', true)).toBe('done')
    expect(workflowAgentTileStatus('running', true)).toBe('running')
    expect(workflowAgentTileStatus('failed', true)).toBe('failed')
    expect(workflowAgentTileStatus('pending', true)).toBe('queued')
    expect(workflowAgentTileStatus('cancelled', true)).toBe('stopped')
    expect(workflowAgentTileStatus(undefined, true)).toBe('running')
  })

  it('marks agents the finished run cut off as stopped', () => {
    expect(workflowAgentTileStatus('running', false)).toBe('stopped')
    expect(workflowAgentTileStatus('pending', false)).toBe('stopped')
    expect(workflowAgentTileStatus('completed', false)).toBe('done')
    expect(workflowAgentTileStatus(undefined, false)).toBe('done')
  })
})

describe('groupWorkflowAgents', () => {
  const agent = (agentId: string, phase?: string, subworkflow?: string) => ({ agentId, phase, subworkflow })

  it('keeps declared phase order, including phases with no agents yet', () => {
    const groups = groupWorkflowAgents(
      [{ title: 'Review', detail: 'find' }, { title: 'Verify' }, { title: 'Fix' }],
      [agent('v1', 'Verify'), agent('r1', 'Review'), agent('r2', 'Review')],
    )
    expect(groups.map((g) => [g.phase.title, g.agents.map((a) => a.agentId)])).toEqual([
      ['Review', ['r1', 'r2']],
      ['Verify', ['v1']],
      ['Fix', []],
    ])
    expect(groups[0].phase.detail).toBe('find')
  })

  it('appends runtime-only phases and collects phaseless agents under an untitled group', () => {
    const groups = groupWorkflowAgents([{ title: 'Scan' }], [agent('a', 'Scan'), agent('b', 'Extra'), agent('c')])
    expect(groups.map((g) => g.phase.title)).toEqual(['Scan', 'Extra', ''])
    expect(groups[2].agents.map((a) => a.agentId)).toEqual(['c'])
  })

  it('nests a child workflow under its host phase, split by the child phases', () => {
    const groups = groupWorkflowAgents(
      [{ title: 'Review' }, { title: 'Verify' }],
      [agent('r1', 'Review'), agent('s1', 'Scout', 'repro'), agent('p1', 'Repro', 'repro'), agent('s2', 'Scout', 'repro')],
      [{ name: 'repro', hostPhase: 'Verify', description: 'build repros', phases: [{ title: 'Repro', detail: 'one per finding' }, { title: 'Scout' }] }],
    )
    const verify = groups.find((g) => g.phase.title === 'Verify')!
    expect(verify.agents).toEqual([])
    expect(verify.children).toHaveLength(1)
    const child = verify.children[0]
    expect(child.workflow.description).toBe('build repros')
    expect(child.sections.map((s) => [s.phase.title, s.agents.map((a) => a.agentId)])).toEqual([
      ['Repro', ['p1']],
      ['Scout', ['s1', 's2']],
    ])
    expect(child.sections[0].phase.detail).toBe('one per finding')
  })

  it('places a child workflow with unknown host under the untitled group', () => {
    const groups = groupWorkflowAgents([], [agent('x', 'Inner', 'child')])
    expect(groups).toHaveLength(1)
    expect(groups[0].phase.title).toBe('')
    expect(groups[0].children[0].workflow.name).toBe('child')
  })
})
