import { describe, expect, it } from 'vitest'
import type { SessionMessageBlock } from '@superone/shared/environment'
import {
  preferCatalogMessages,
  sessionMessageBlocksToChatMessages,
} from './remote-message-catalog'

describe('remote-message-catalog', () => {
  it('maps denser blocks including tool_use/result', () => {
    const blocks: SessionMessageBlock[] = [
      {
        id: 'u1',
        role: 'user',
        text: 'hi',
        createdAt: 1,
        sortOrder: 0,
      },
      {
        id: 'a1',
        role: 'assistant',
        text: 'done',
        createdAt: 2,
        sortOrder: 1,
        tools: [
          {
            toolUseId: 't1',
            toolName: 'Read',
            inputSummary: '{"path":"a"}',
            outputSummary: 'ok',
          },
        ],
        resumePointId: 'resume-1',
      },
    ]
    const msgs = sessionMessageBlocksToChatMessages(blocks, 'codex')
    expect(msgs).toHaveLength(2)
    expect(msgs[1]!.content).toEqual(
      expect.arrayContaining([
        { type: 'text', text: 'done' },
        expect.objectContaining({ type: 'tool_use', toolUseId: 't1', toolName: 'Read' }),
        expect.objectContaining({ type: 'tool_result', toolUseId: 't1', summary: 'ok' }),
      ]),
    )
    expect(msgs[1]!.resumePointId).toBe('resume-1')
  })

  it('preferCatalogMessages keeps richer local content', () => {
    const local = [
      {
        id: 'a1',
        role: 'assistant' as const,
        status: 'complete' as const,
        content: [
          { type: 'text' as const, text: 'streamed' },
          {
            type: 'tool_use' as const,
            toolName: 'Bash',
            toolUseId: 't',
            input: 'ls',
            status: 'complete' as const,
          },
        ],
        createdAt: new Date().toISOString(),
        providerId: 'codex',
      },
    ]
    const catalog = sessionMessageBlocksToChatMessages([
      {
        id: 'a1',
        role: 'assistant',
        text: 'done',
        createdAt: 1,
        sortOrder: 0,
      },
    ])
    const merged = preferCatalogMessages(local, catalog)
    expect(merged).toHaveLength(1)
    expect(merged[0]!.content.length).toBe(2)
  })
})
