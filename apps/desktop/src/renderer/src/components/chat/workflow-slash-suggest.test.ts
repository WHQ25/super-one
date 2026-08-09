import { describe, it, expect } from 'vitest'
import type { ContentBlock, SlashCommandInfo } from '@superone/shared/agent-types'
import {
  parseWorkflowSlashPhase,
  catalogWorkflows,
  sessionRunNames,
  buildWorkflowSuggestItems,
  applyWorkflowSuggestion,
  resolveWorkflowArgsTip,
  groupWorkflowSuggestItems,
} from './workflow-slash-suggest'

describe('parseWorkflowSlashPhase', () => {
  it('empty args → first token mode', () => {
    expect(parseWorkflowSlashPhase('')).toEqual({
      prefix: '',
      partial: '',
      afterOp: null,
      afterName: null,
      done: false,
    })
  })

  it('partial first token', () => {
    expect(parseWorkflowSlashPhase('pa')).toMatchObject({ partial: 'pa', afterOp: null, done: false })
    expect(parseWorkflowSlashPhase('review')).toMatchObject({ partial: 'review', done: false })
  })

  it('completed op with trailing space → afterOp', () => {
    expect(parseWorkflowSlashPhase('pause ')).toMatchObject({
      afterOp: 'pause',
      partial: '',
      afterName: null,
      done: false,
    })
  })

  it('op + partial run name', () => {
    expect(parseWorkflowSlashPhase('stop rev')).toMatchObject({
      afterOp: 'stop',
      partial: 'rev',
      done: false,
    })
  })

  it('launch name with trailing space → afterName (args tip), not done', () => {
    expect(parseWorkflowSlashPhase('review-changes ')).toMatchObject({
      afterName: 'review-changes',
      afterOp: null,
      done: false,
      partial: '',
    })
  })

  it('launch name + freeform args keeps afterName', () => {
    expect(parseWorkflowSlashPhase('review-changes {"x":1}')).toMatchObject({
      afterName: 'review-changes',
      partial: '{"x":1}',
      done: false,
    })
  })

  it('name-first manage op as second token', () => {
    expect(parseWorkflowSlashPhase('review-changes pau')).toMatchObject({
      afterName: 'review-changes',
      partial: 'pau',
      done: false,
    })
  })
})

describe('catalogWorkflows', () => {
  it('keeps isWorkflow, description strip, and argumentHint', () => {
    const cmds: SlashCommandInfo[] = [
      {
        name: 'review-changes',
        description: 'Workflow: Review the PR',
        argumentHint: '<args>',
        isSkill: false,
        isWorkflow: true,
        workflowSource: 'project',
      },
      { name: 'clear', description: 'Clear', argumentHint: '', isSkill: false },
      { name: 'deep-research', description: 'Workflow: Research', argumentHint: '', isSkill: false },
    ]
    const cat = catalogWorkflows(cmds)
    expect(cat.map((w) => w.name)).toEqual(['review-changes', 'deep-research'])
    expect(cat[0]).toMatchObject({
      description: 'Review the PR',
      argumentHint: '<args>',
      source: 'project',
    })
  })
})

describe('sessionRunNames', () => {
  it('extracts live workflow display names with status from taskProgress', () => {
    const messages = [{
      content: [
        {
          type: 'tool_use',
          toolUseId: 't1',
          toolName: 'Workflow',
          input: JSON.stringify({ name: 'review-changes' }),
          status: 'complete',
        } as ContentBlock,
        {
          type: 'tool_result',
          toolUseId: 't1',
          summary: JSON.stringify({ run_id: 'wf_1', name: 'review-changes' }),
          isError: false,
        } as ContentBlock,
      ],
    }]
    const runs = sessionRunNames(messages, {
      t1: { completed: false, description: 'phase: Plan' },
    })
    expect(runs).toEqual([{
      name: 'review-changes',
      description: 'phase: Plan',
      status: 'running',
    }])
  })
})

describe('buildWorkflowSuggestItems + apply', () => {
  const catalog = [
    { name: 'review-changes', description: 'Review the PR diff', source: 'project', argumentHint: '<args>' },
    { name: 'deep-research', description: 'Research a topic', source: 'builtin' },
  ]
  const runs = [{ name: 'review-changes', description: 'running', status: 'running' as const }]

  it('empty first token lists ops then workflows', () => {
    const phase = parseWorkflowSlashPhase('')
    const items = buildWorkflowSuggestItems(phase, { catalog, runs })
    expect(items.filter((i) => i.kind === 'op').map((i) => i.name)).toEqual([
      'pause', 'resume', 'stop', 'save',
    ])
    expect(items.filter((i) => i.kind === 'workflow').map((i) => i.name)).toEqual([
      'deep-research', 'review-changes',
    ])
  })

  it('fuzzy matches name and description', () => {
    expect(buildWorkflowSuggestItems(parseWorkflowSlashPhase('rev'), { catalog, runs }).some((i) => i.name === 'review-changes')).toBe(true)
    expect(buildWorkflowSuggestItems(parseWorkflowSlashPhase('topic'), { catalog, runs }).some((i) => i.name === 'deep-research')).toBe(true)
  })

  it('after pause suggests session runs', () => {
    const items = buildWorkflowSuggestItems(parseWorkflowSlashPhase('pause '), { catalog, runs })
    expect(items.map((i) => i.kind)).toEqual(['run'])
    expect(items[0]?.name).toBe('review-changes')
    expect(items[0]?.status).toBe('running')
  })

  it('after name with empty partial has no list (Enter launches; tip shows args)', () => {
    const items = buildWorkflowSuggestItems(parseWorkflowSlashPhase('review-changes '), { catalog, runs })
    expect(items).toEqual([])
  })

  it('after name never surfaces manage ops (use /workflow pause form)', () => {
    expect(buildWorkflowSuggestItems(parseWorkflowSlashPhase('review-changes pa'), { catalog, runs })).toEqual([])
    expect(buildWorkflowSuggestItems(parseWorkflowSlashPhase('review-changes {"a":1}'), { catalog, runs })).toEqual([])
  })

  it('apply fills command line with trailing space', () => {
    expect(applyWorkflowSuggestion(parseWorkflowSlashPhase(''), {
      id: 'workflow:review-changes',
      kind: 'workflow',
      name: 'review-changes',
      description: '',
      matchIndices: [],
      score: 1,
    })).toBe('/workflow review-changes ')

    expect(applyWorkflowSuggestion(parseWorkflowSlashPhase('pause '), {
      id: 'run:review-changes',
      kind: 'run',
      name: 'review-changes',
      description: '',
      matchIndices: [],
      score: 1,
    })).toBe('/workflow pause review-changes ')

  })
})

describe('resolveWorkflowArgsTip', () => {
  const catalog = [
    { name: 'review-changes', description: 'Review the PR', source: 'project', argumentHint: '<args>' },
  ]

  it('shows tip after launch name', () => {
    const tip = resolveWorkflowArgsTip(parseWorkflowSlashPhase('review-changes '), catalog)
    expect(tip).toMatchObject({
      name: 'review-changes',
      description: 'Review the PR',
      argumentHint: '<args>',
      exampleLine: '/workflow review-changes ',
    })
  })

  it('uses parsed script args in the tip when provided', () => {
    const tip = resolveWorkflowArgsTip(
      parseWorkflowSlashPhase('review-changes '),
      catalog,
      {
        whenToUse: 'When reviewing PRs',
        args: [
          { name: 'target', description: 'git range' },
          { name: 'depth', description: 'how deep', required: false },
        ],
        exampleJson: '{"target":"","depth":""}',
      },
    )
    expect(tip?.argumentHint).toBe('target · depth')
    expect(tip?.exampleLine).toBe('/workflow review-changes {"target":"","depth":""} ')
    expect(tip?.args?.map((a) => a.name)).toEqual(['target', 'depth'])
    expect(tip?.whenToUse).toMatch(/reviewing/)
  })

  it('hides tip when typing a manage op', () => {
    expect(resolveWorkflowArgsTip(parseWorkflowSlashPhase('review-changes pau'), catalog)).toBeNull()
  })

  it('keeps tip while typing JSON args', () => {
    const tip = resolveWorkflowArgsTip(parseWorkflowSlashPhase('review-changes {"x":1}'), catalog)
    expect(tip?.name).toBe('review-changes')
  })
})

describe('groupWorkflowSuggestItems', () => {
  it('groups in manage / launch / session order', () => {
    const groups = groupWorkflowSuggestItems([
      { id: '1', kind: 'workflow', name: 'a', description: '', matchIndices: [], score: 0 },
      { id: '2', kind: 'op', name: 'pause', description: '', matchIndices: [], score: 0 },
      { id: '3', kind: 'run', name: 'b', description: '', matchIndices: [], score: 0 },
    ])
    expect(groups.map((g) => g.key)).toEqual(['op', 'workflow', 'run'])
  })
})
