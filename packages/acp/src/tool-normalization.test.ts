import { describe, expect, it } from 'vitest'
import { normalizeAcpTool } from './tool-normalization'

describe('normalizeAcpTool background bash', () => {
  it('treats block_until_ms 0 and is_background as background, and a positive wait as foreground', () => {
    expect(normalizeAcpTool({
      toolCallId: 'c1',
      kind: 'execute',
      rawInput: { command: 'bun install', block_until_ms: 0 },
    })?.input).toMatchObject({ command: 'bun install', run_in_background: true })
    expect(normalizeAcpTool({
      toolCallId: 'c2',
      kind: 'execute',
      rawInput: { command: 'sleep 2', block_until_ms: 2000 },
    })?.input).toEqual({ command: 'sleep 2' })
    expect(normalizeAcpTool({
      toolCallId: 'c3',
      kind: 'execute',
      rawInput: { command: 'tail -f log', is_background: true },
    })?.input).toMatchObject({ run_in_background: true })
  })
})

describe('normalizeAcpTool update_steps', () => {
  it('normalizes update_steps to TodoWrite with todos', () => {
    expect(normalizeAcpTool({
      toolCallId: 's1',
      title: 'update steps',
      rawInput: {
        steps: [
          { title: 'Inspect code', status: 'done' },
          { title: 'Skip optional', status: 'skipped' },
          { title: 'Failed step', status: 'failed' },
          { title: 'Update mapping', status: 'in_progress' },
          { title: 'Verify tests', status: 'pending' },
        ],
      },
    })).toEqual({
      toolName: 'TodoWrite',
      input: {
        todos: [
          { content: 'Inspect code', status: 'completed' },
          { content: 'Skip optional', status: 'skipped' },
          { content: 'Failed step', status: 'failed' },
          { content: 'Update mapping', status: 'in_progress', activeForm: 'Update mapping' },
          { content: 'Verify tests', status: 'pending' },
        ],
      },
      toolFilePath: undefined,
      toolSummary: 'update steps',
      terminalId: undefined,
    })
  })
})
