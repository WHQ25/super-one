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
      .toEqual(['tool_use:start', 'tool_result:start', 'text:', 'tool_use:foreign', 'tool_result:foreign'])
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
    expect(smoke.segments.map((segment) => segment.kind)).toEqual(['block', 'block'])
  })
})
