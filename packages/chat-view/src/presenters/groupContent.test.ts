import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@superone/shared/agent-types'
import {
  groupContentPresenter,
  type GroupContentPorts,
} from './groupContent'

function toolUse(
  toolUseId: string,
  toolName: string,
  parentToolUseId?: string,
): ContentBlock & { type: 'tool_use' } {
  return {
    type: 'tool_use',
    toolUseId,
    toolName,
    input: '{}',
    status: 'complete',
    ...(parentToolUseId ? { parentToolUseId } : {}),
  }
}

function toolResult(toolUseId: string, summary = 'ok'): ContentBlock {
  return { type: 'tool_result', toolUseId, summary, isError: false }
}

const ports: GroupContentPorts = {
  isSubagentToolName: (name) => name === 'Task',
  isWorkflowSmokeCheck: (input) => input.includes('validate_only'),
  isHiddenToolBlock: (name) => name === 'TodoWrite',
  resolveAppTool: (name) => name === 'mcp__superone__weather'
    ? { appId: 'weather', groupable: true, standalone: false }
    : null,
}

describe('groupContentPresenter', () => {
  it('passes a projected Bash diff to the mobile row and turn statistics', () => {
    const bashEditDiff = {
      files: [], moreFiles: 1, changedFiles: ['/p/a.ts'],
      summary: { files: 1, added: 2, removed: 1, approximate: false },
      fileChanges: [{ path: '/p/a.ts', added: 2, removed: 1 }],
    }
    const result = groupContentPresenter([
      toolUse('bash', 'Bash'),
      { type: 'bash_result', toolUseId: 'bash', summary: '', bashEditDiff },
    ], ports)
    expect(result.bashEditDiffMap.get('bash')).toEqual(bashEditDiff)
  })

  it('groups read-only and app tools while dropping hidden tool shells', () => {
    const result = groupContentPresenter([
      toolUse('read', 'Read'),
      toolResult('read'),
      toolUse('hidden', 'TodoWrite'),
      toolResult('hidden'),
      toolUse('app', 'mcp__superone__weather'),
      toolResult('app'),
    ], ports)

    expect(result.segments.map((segment) => segment.kind)).toEqual(['tools', 'app-tools'])
    expect(result.segments[1]).toMatchObject({ kind: 'app-tools', appId: 'weather' })
    expect(result.toolNameMap.get('read')).toBe('Read')
    expect(result.toolResultMap.get('app')).toBe('ok')
  })

  it('keeps reasoning and read groups whole when parallel results arrive between them', () => {
    const thinking = (text: string): ContentBlock => ({ type: 'thinking', thinking: text })
    const result = groupContentPresenter([
      toolUse('build', 'Bash'),
      toolUse('test', 'Bash'),
      thinking('first'),
      toolResult('build'),
      thinking('second'),
      toolResult('test'),
      toolUse('read-1', 'Read'),
      toolResult('build'),
      toolUse('read-2', 'Read'),
      toolResult('read-1'),
      toolResult('read-2'),
    ], ports)

    expect(result.segments.map((segment) => segment.kind)).toEqual(['block', 'block', 'thinking', 'tools'])
    expect(result.segments[2]).toMatchObject({ kind: 'thinking', blocks: [{ thinking: 'first' }, { thinking: 'second' }] })
    expect(result.segments[3]).toMatchObject({ kind: 'tools', blocks: [{ toolUseId: 'read-1' }, { toolUseId: 'read-2' }] })
  })

  it('keeps nested subagent output attached after the parent result arrives', () => {
    const result = groupContentPresenter([
      toolUse('parent', 'Task'),
      toolResult('parent', 'started'),
      toolUse('child', 'Read', 'parent'),
    ], ports)

    expect(result.segments).toHaveLength(1)
    const segment = result.segments[0]
    expect(segment.kind).toBe('subagent')
    if (segment.kind !== 'subagent') return
    expect(segment.resultBlock).toMatchObject({ type: 'tool_result', toolUseId: 'parent' })
    expect(segment.childBlocks).toHaveLength(1)
  })

  it('folds a run\'s resume calls into the call that started it, leaving the model\'s own blocks in place', () => {
    const paused = JSON.stringify({ status: 'paused', runId: 'r1a2b3c4', progress: { completed: [] }, steps: 2 })
    const result = groupContentPresenter([
      { ...toolUse('start', 'mcp__superone__computer_run'), input: '{"goal":"Save the note","app":"Notes"}' },
      toolResult('start', paused),
      { type: 'text', text: 'It asks which button; Save is right.' },
      { ...toolUse('resume', 'mcp__superone__computer_run'), input: '{"runId":"r1a2b3c4","answer":{"questionId":"q1","choice":"3"}}' },
      toolResult('resume', paused.replace('paused', 'done')),
      // A resume of a run this turn never started stands on its own.
      { ...toolUse('foreign', 'mcp__superone__computer_run'), input: '{"runId":"r9","answer":{"questionId":"q2","choice":"accept"}}' },
      toolResult('foreign', JSON.stringify({ status: 'done', runId: 'r9' })),
    ], ports)

    expect(result.segments.map((segment) => segment.kind === 'block' ? `${segment.block.type}:${'toolUseId' in segment.block ? segment.block.toolUseId : ''}` : segment.kind))
      .toEqual(['tool_use:start', 'text:', 'tool_use:foreign'])
    expect(result.runContinuations.get('start')?.map((block) => block.toolUseId)).toEqual(['resume'])
    // The folded call's result is still there for the block to read.
    expect(result.toolResultMap.get('resume')).toContain('"done"')
  })

  it('separates live workflow presentation from validation smoke checks', () => {
    const live = groupContentPresenter([
      { ...toolUse('live', 'Workflow'), input: '{"name":"review"}' },
      toolResult('live'),
    ], ports)
    const smoke = groupContentPresenter([
      { ...toolUse('smoke', 'Workflow'), input: '{"validate_only":true}' },
      toolResult('smoke'),
    ], ports)

    expect(live.segments.map((segment) => segment.kind)).toEqual(['workflow'])
    expect(smoke.segments.map((segment) => segment.kind)).toEqual(['block'])
  })
})

describe('regrouping a streamed turn', () => {
  const turn: ContentBlock[] = [
    { type: 'text', text: 'Looking.' },
    toolUse('read-1', 'Read'),
    toolResult('read-1'),
    toolUse('read-2', 'Read'),
    toolUse('task', 'Task'),
    { ...toolUse('child', 'Bash', 'task'), status: 'streaming' },
    { type: 'thinking', thinking: 'Hm' },
    { type: 'text', text: 'Found' },
  ]
  const grouped = { content: turn, result: groupContentPresenter(turn, ports) }
  const replace = (index: number, block: ContentBlock) => turn.map((value, at) => at === index ? block : value)

  it.each([
    ['streamed text', replace(7, { type: 'text', text: 'Found it.' })],
    ['streamed reasoning', replace(6, { type: 'thinking', thinking: 'Hm, so' })],
    ['progress on a grouped call', replace(3, { ...toolUse('read-2', 'Read'), elapsedSeconds: 2 })],
    ['progress inside a subagent', replace(5, { ...toolUse('child', 'Bash', 'task'), liveOutput: 'line' })],
    ['a call whose input grew', replace(3, { ...toolUse('read-2', 'Read'), input: '{"file_path":"a"}' })],
    ['a call that became hidden', replace(3, toolUse('read-2', 'TodoWrite'))],
    ['an arriving result', [...replace(3, { ...toolUse('read-2', 'Read'), elapsedSeconds: 2 }), toolResult('read-2')]],
    ['two replaced blocks', replace(0, { type: 'text', text: 'Look.' }).map((value, at) => at === 7 ? { type: 'text', text: 'Found it.' } as ContentBlock : value)],
  ])('groups %s as a fresh pass does', (_name, content) => {
    expect(groupContentPresenter(content, ports, grouped)).toEqual(groupContentPresenter(content, ports))
  })

  it('keeps the segments and results a text delta did not touch', () => {
    const result = groupContentPresenter(replace(7, { type: 'text', text: 'Found it.' }), ports, grouped)
    expect(result.segments.slice(0, -1)).toEqual(grouped.result.segments.slice(0, -1))
    result.segments.slice(0, -1).forEach((segment, index) => expect(segment).toBe(grouped.result.segments[index]))
    expect(result.toolResultBlockMap).toBe(grouped.result.toolResultBlockMap)
    expect(result.segments.at(-1)).toMatchObject({ kind: 'block', block: { text: 'Found it.' } })
  })
})
