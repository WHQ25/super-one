import { describe, expect, it } from 'vitest'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import {
  countTools,
  extractMessageText,
  extractToolIndex,
  findToolDetail,
  formatTextMessages,
  formatToolIndex,
  pageItems,
} from './session-transcript-view'

function msg(
  id: string,
  role: 'user' | 'assistant',
  content: ContentBlock[],
): ChatMessage {
  return {
    id,
    role,
    status: 'complete',
    content,
    createdAt: '2026-01-01T00:00:00.000Z',
    providerId: 'claude',
  }
}

describe('session-transcript-view', () => {
  it('extracts pure text without tool lines', () => {
    const m = msg('a1', 'assistant', [
      { type: 'text', text: 'Done.' },
      { type: 'tool_use', toolName: 'Read', toolUseId: 't1', input: '{"path":"x.ts"}', status: 'complete' },
      { type: 'thinking', thinking: 'secret' },
    ])
    expect(extractMessageText(m)).toBe('Done.')
    expect(extractMessageText(m, { includeThinking: true })).toContain('secret')
    expect(countTools(m)).toBe(1)
  })

  it('indexes tools with targets and finds detail', () => {
    const messages = [
      msg('u1', 'user', [{ type: 'text', text: 'fix it' }]),
      msg('a1', 'assistant', [
        { type: 'text', text: 'ok' },
        {
          type: 'tool_use',
          toolName: 'Edit',
          toolUseId: 'tu-1',
          input: JSON.stringify({ file_path: 'src/a.ts' }),
          status: 'complete',
        },
        { type: 'tool_result', toolUseId: 'tu-1', summary: 'patched', isError: false },
      ]),
    ]
    const index = extractToolIndex(messages[1])
    expect(index).toEqual([
      expect.objectContaining({
        toolUseId: 'tu-1',
        toolName: 'Edit',
        target: 'src/a.ts',
        messageId: 'a1',
      }),
    ])
    expect(formatToolIndex(index)).toContain('Edit')
    expect(formatToolIndex(index)).toContain('tu-1')

    const detail = findToolDetail(messages, 'tu-1')
    expect(detail).toMatchObject({
      toolUseId: 'tu-1',
      toolName: 'Edit',
      messageId: 'a1',
      resultSummary: 'patched',
    })
    expect(findToolDetail(messages, 'missing')).toBeNull()
  })

  it('paginates newest-first and anchors with messageId/around', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}` }))
    const newest = pageItems(items, { limit: 3 })
    expect(newest.items.map((x) => x.id)).toEqual(['m7', 'm8', 'm9'])
    expect(newest.hasMore).toBe(true)
    expect(newest.cursor).toBe(7)

    const older = pageItems(items, { limit: 3, cursor: newest.cursor })
    expect(older.items.map((x) => x.id)).toEqual(['m4', 'm5', 'm6'])

    const around = pageItems(items, { limit: 10, messageId: 'm5', around: 1 })
    expect(around.items.map((x) => x.id)).toEqual(['m4', 'm5', 'm6'])
  })

  it('formatTextMessages marks toolCount on assistant when requested', () => {
    const text = formatTextMessages(
      [
        msg('u1', 'user', [{ type: 'text', text: 'hi' }]),
        msg('a1', 'assistant', [
          { type: 'text', text: 'yo' },
          { type: 'tool_use', toolName: 'Bash', toolUseId: 'b1', input: '{}' },
        ]),
      ],
      { withToolCount: true },
    )
    expect(text).toContain('tools:1')
    expect(text).not.toContain('Bash')
  })
})
