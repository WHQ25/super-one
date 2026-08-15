/** @vitest-environment jsdom */
/**
 * Cursor nested-task deltas must land inside the Agent card, not as top-level
 * chat rows. SuperOne grouping keys off `parentToolUseId`; the Cursor mapper
 * has to stamp the launching task's callId onto every nested block.
 */
import { describe, expect, it } from 'vitest'
import { mapInteractionUpdate } from '@superone/cursor'
import { applyContentDelta } from '@superone/shared/content-delta'
import type { AgentEvent, ContentBlock } from '@superone/shared/agent-types'
import { groupContent } from '../../renderer/src/components/chat/ChatMessage'

function replay(updates: unknown[]): ContentBlock[] {
  let content: ContentBlock[] = []
  for (const update of updates) {
    for (const event of mapInteractionUpdate('m1', update as never) as AgentEvent[]) {
      if (event.type !== 'content_delta') continue
      content = applyContentDelta(content, event.delta)
    }
  }
  return content
}

function parentOf(block: ContentBlock): string | null {
  return 'parentToolUseId' in block ? block.parentToolUseId ?? null : null
}

describe('Cursor subagent grouping', () => {
  it('keeps nested Grep/text inside the Agent card instead of the main transcript', () => {
    const content = replay([
      {
        type: 'tool-call-started',
        callId: 'task-1',
        toolCall: {
          type: 'task',
          args: { description: 'Cursor edit diff UI', prompt: 'inspect the diff UI' },
        },
      },
      {
        type: 'tool-call-delta',
        callId: 'task-1',
        taskUpdate: { type: 'text-delta', text: 'searching the renderer' },
      },
      {
        type: 'tool-call-delta',
        callId: 'task-1',
        taskUpdate: {
          type: 'tool-call-started',
          callId: 'grep-1',
          toolCall: { type: 'grep', args: { pattern: 'ToolBlock' } },
        },
      },
      {
        type: 'tool-call-delta',
        callId: 'task-1',
        taskUpdate: {
          type: 'tool-call-completed',
          callId: 'grep-1',
          toolCall: {
            type: 'grep',
            args: { pattern: 'ToolBlock' },
            result: { status: 'success', value: { matches: 1 } },
          },
        },
      },
      {
        type: 'tool-call-completed',
        callId: 'task-1',
        toolCall: {
          type: 'task',
          args: { description: 'Cursor edit diff UI', prompt: 'inspect the diff UI' },
          result: { status: 'success', value: { isBackground: false, resultSuffix: 'done' } },
        },
      },
    ])

    const { segments } = groupContent(content, [])
    expect(segments.map((s) => s.kind)).toEqual(['subagent'])

    const sub = segments[0] as { kind: 'subagent'; childBlocks: ContentBlock[] }
    expect(sub.childBlocks.some((b) => b.type === 'tool_use' && b.toolName === 'Grep')).toBe(true)
    expect(sub.childBlocks.some((b) => b.type === 'text' && parentOf(b) === 'task-1')).toBe(true)

    const leaked = content.filter((b) => parentOf(b) !== null && !sub.childBlocks.includes(b))
    expect(leaked).toEqual([])
  })
})
