import { describe, expect, it } from 'vitest'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import {
  countTools,
  extractMessageText,
  extractToolIndex,
  findToolDetail,
  formatTextMessages,
  formatTextBlocks,
  formatToolIndex,
  pageItems,
  pageTextBlocks,
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
  it('reads a stored legacy Codex turn as its replies and tools, not just the final text', () => {
    const stored: ChatMessage = { ...msg('c1', 'assistant', [{ type: 'text', text: 'Done' }]), providerId: 'codex',
      metadata: { codex: { threadId: 't', usage: null, items: [
        { id: 'a1', type: 'agent_message', text: 'Checking the tests.' },
        { id: 'cmd', type: 'command_execution', command: 'bun test', aggregatedOutput: 'ok', exitCode: 0, status: 'completed' },
        { id: 'a2', type: 'agent_message', text: 'Done' },
      ] } } }
    expect(extractMessageText(stored)).toBe('Checking the tests.\n\nDone')
    expect(extractToolIndex(stored)).toEqual([expect.objectContaining({ toolUseId: 'cmd', toolName: 'Bash', messageId: 'c1' })])
    expect(findToolDetail([stored], 'cmd')).toMatchObject({ input: expect.stringContaining('bun test'), resultSummary: 'ok' })
  })

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

  it('pages across roles and message boundaries without losing or repeating blocks', () => {
    const messages = [
      msg('a1', 'assistant', [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }]),
      msg('u1', 'user', [{ type: 'text', text: 'prompt' }]),
      msg('a2', 'assistant', [{ type: 'text', text: 'three' }, { type: 'text', text: 'four' }]),
    ]
    const newest = pageTextBlocks(messages, { view: 'assistant', limit: 3 })
    expect(newest.items.map(block => block.text)).toEqual(['two', 'three', 'four'])
    expect(newest).toMatchObject({ total: 4, cursor: 1, hasMore: true })
    const older = pageTextBlocks(messages, { view: 'assistant', limit: 3, cursor: newest.cursor })
    expect(older.items.map(block => block.text)).toEqual(['one'])
    expect(older).toMatchObject({ cursor: null, hasMore: false })
    const text = formatTextBlocks(newest.items)
    expect(text).toContain('textBlocks:2-2/2')
    expect(text).toContain('textBlocks:1-2/2')
    expect(text).not.toContain('prompt')
    expect(pageTextBlocks(messages, { view: 'text', limit: 3 }).items.map(block => block.text))
      .toEqual(['prompt', 'three', 'four'])
  })

  it('skips empty, internal and tool blocks, and counts optional thinking and plans', () => {
    const messages = [msg('a1', 'assistant', [
      { type: 'text', text: '  ' },
      { type: 'text', text: '<task-notification>internal</task-notification>' },
      { type: 'tool_use', toolName: 'Read', toolUseId: 't1', input: '{}' },
      { type: 'thinking', thinking: 'thought' },
      { type: 'plan', text: 'plan', id: 'plan-1' },
      { type: 'review', phase: 'entered', text: 'uncommitted changes', id: 'review-1' },
      { type: 'notice', level: 'error', text: 'transient failure', id: 'error-1' },
      { type: 'text', id: 'question-1', text: 'Which branch?', codexAsyncQuestions: [{ title: 'Which branch?', options: null }] },
      { type: 'text', text: 'reply\n\nwith two paragraphs' },
      { type: 'review', phase: 'exited', text: 'No findings.', id: 'review-1_exit' },
    ])]
    const page = pageTextBlocks(messages, { view: 'text', limit: 20 })
    expect(page.items.map(block => block.text)).toEqual(['plan', 'reply\n\nwith two paragraphs', 'No findings.'])
    expect(page.total).toBe(3)
    const thinking = pageTextBlocks(messages, { view: 'text', limit: 1, cursor: 1, includeThinking: true })
    expect(thinking.items.map(block => block.text)).toEqual(['thought'])
    expect(thinking.total).toBe(4)
  })

  it('anchors at the last block and keeps cursors in the selected view', () => {
    const messages = [
      msg('a1', 'assistant', [{ type: 'text', text: 'before' }]),
      msg('u1', 'user', [{ type: 'text', text: 'prompt' }]),
      msg('a2', 'assistant', Array.from({ length: 60 }, (_, i) => ({ type: 'text', text: `block ${i}` }))),
    ]
    const anchored = pageTextBlocks(messages, { view: 'assistant', limit: 1, messageId: 'a2' })
    expect(anchored.items.map(block => block.text)).toEqual(['block 59'])
    const around = pageTextBlocks(messages, { view: 'assistant', limit: 1, messageId: 'a2', around: 50 })
    expect(around.items.map(block => block.text)).toEqual(['block 59'])
    const crossRole = pageTextBlocks(messages, { view: 'assistant', limit: 20, messageId: 'u1', around: 1 })
    expect(crossRole.items.map(block => block.text)).toEqual(['before', 'block 0'])
    expect(crossRole.cursor).toBeNull()
    const continued = pageTextBlocks(messages, { view: 'assistant', limit: 2, cursor: anchored.cursor, messageId: 'a2', around: 0 })
    expect(continued.items.map(block => block.text)).toEqual(['block 57', 'block 58'])
    expect(pageTextBlocks(messages, { view: 'assistant', limit: 20, messageId: 'missing' }).items).toEqual([])
    expect(pageTextBlocks([], { view: 'text', limit: 20 })).toMatchObject({ items: [], total: 0, cursor: null })
  })
})
