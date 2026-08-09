import { describe, expect, it } from 'vitest'
import type { SessionMessageBlock } from '@superone/shared/environment'
import {
  preferCatalogMessages,
  sessionMessageBlocksToChatMessages,
} from './remote-message-catalog'

describe('remote-message-catalog', () => {
  it('prefers event-ordered content over text+tools when present', () => {
    const blocks: SessionMessageBlock[] = [
      {
        id: 'a1',
        role: 'assistant',
        text: 'done',
        createdAt: 2,
        sortOrder: 0,
        // Flat tools list would put tools after text if used — ordered content wins.
        tools: [
          {
            toolUseId: 't1',
            toolName: 'Read',
            inputSummary: '{"path":"a"}',
            outputSummary: 'ok',
          },
        ],
        content: [
          {
            type: 'tool_use',
            toolUseId: 't1',
            toolName: 'Read',
            input: '{"path":"a"}',
            status: 'complete',
          },
          { type: 'tool_result', toolUseId: 't1', summary: 'ok' },
          { type: 'text', text: 'done' },
        ],
        resumePointId: 'resume-1',
      },
    ]
    const msgs = sessionMessageBlocksToChatMessages(blocks, 'claude')
    expect(msgs[0]!.content.map((b) => b.type)).toEqual(['tool_use', 'tool_result', 'text'])
    expect(msgs[0]!.content[2]).toEqual({ type: 'text', text: 'done' })
    expect(msgs[0]!.resumePointId).toBe('resume-1')
  })

  it('legacy text+tools fallback keeps tools before conclusion text', () => {
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
    expect(msgs[1]!.content.map((b) => b.type)).toEqual(['tool_use', 'tool_result', 'text'])
    expect(msgs[1]!.content).toEqual([
      expect.objectContaining({ type: 'tool_use', toolUseId: 't1', toolName: 'Read' }),
      expect.objectContaining({ type: 'tool_result', toolUseId: 't1', summary: 'ok' }),
      { type: 'text', text: 'done' },
    ])
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

  const turnMsg = (
    id: string,
    role: 'user' | 'assistant',
    text: string,
  ) => ({
    id,
    role,
    status: 'complete' as const,
    content: [{ type: 'text' as const, text }],
    createdAt: new Date().toISOString(),
    providerId: 'claude',
  })

  /**
   * User report: multi-turn remote session already has several rounds; after
   * switching sessions, earlier agent replies disappear from the head of the
   * thread.
   *
   * Mechanism: switchSession hydrates via session.messages.list which returns a
   * newest-page *suffix*. Catalog-first merge (walk catalog, append unused local)
   * yields order like [u2,a2,u3,a3,u1,a1] — early agent a1 is no longer at the top.
   */
  describe('multi-turn remote switch: catalog suffix loses early agent head order', () => {
    /** 3 completed turns already in renderer memory (user was chatting here). */
    const fullLocalMultiTurn = () => [
      turnMsg('u1', 'user', '第一轮用户'),
      turnMsg('a1', 'assistant', '第一轮 agent 回复'),
      turnMsg('u2', 'user', '第二轮用户'),
      turnMsg('a2', 'assistant', '第二轮 agent 回复'),
      turnMsg('u3', 'user', '第三轮用户'),
      turnMsg('a3', 'assistant', '第三轮 agent 回复'),
    ]

    /**
     * messages.list newest page only (hasMore=true) — same ids as the tail of local.
     * This is what the node returns under limit pagination.
     */
    const newestPageSuffix = () => [
      turnMsg('u2', 'user', '第二轮用户'),
      turnMsg('a2', 'assistant', '第二轮 agent 回复'),
      turnMsg('u3', 'user', '第三轮用户'),
      turnMsg('a3', 'assistant', '第三轮 agent 回复'),
    ]

    /** Documents the pre-fix catalog-first algorithm that caused the bug. */
    function catalogFirstMergeBug(
      localMessages: ReturnType<typeof turnMsg>[],
      catalogMessages: ReturnType<typeof turnMsg>[],
    ) {
      const localById = new Map(localMessages.map((m, i) => [m.id, i] as const))
      const usedLocal = new Set<number>()
      const result: typeof localMessages = []
      for (const cat of catalogMessages) {
        const localAt = localById.get(cat.id)
        if (localAt !== undefined) {
          usedLocal.add(localAt)
          result.push(localMessages[localAt]!)
        } else {
          result.push(cat)
        }
      }
      for (let i = 0; i < localMessages.length; i++) {
        if (!usedLocal.has(i)) result.push(localMessages[i]!)
      }
      return result
    }

    it('BUG (catalog-first): early agent reply is shoved after the latest turns', () => {
      const broken = catalogFirstMergeBug(fullLocalMultiTurn(), newestPageSuffix())
      // This is what the user saw after switch: head starts at turn 2.
      expect(broken.map((m) => m.id)).toEqual(['u2', 'a2', 'u3', 'a3', 'u1', 'a1'])
      expect(broken[0]?.id).not.toBe('u1')
      expect(broken.findIndex((m) => m.id === 'a1')).toBeGreaterThan(
        broken.findIndex((m) => m.id === 'a3'),
      )
    })

    it('FIX: preferCatalogMessages keeps early agent replies at the head in order', () => {
      const merged = preferCatalogMessages(fullLocalMultiTurn(), newestPageSuffix())
      const ids = merged.map((m) => m.id)

      expect(ids).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3'])
      expect(merged.find((m) => m.id === 'a1')?.content).toEqual([
        { type: 'text', text: '第一轮 agent 回复' },
      ])
      expect(ids.indexOf('a1')).toBeLessThan(ids.indexOf('a2'))
      expect(ids.indexOf('a2')).toBeLessThan(ids.indexOf('a3'))
    })

    it('FIX: cold-open still prefers longer catalog history over short local', () => {
      // Memory only has the latest turn; node catalog has the full thread.
      const local = [
        turnMsg('u3', 'user', '第三轮用户'),
        turnMsg('a3', 'assistant', '第三轮 agent 回复（流式更丰）'),
      ]
      const catalog = fullLocalMultiTurn()

      const merged = preferCatalogMessages(local, catalog)
      expect(merged.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3'])
      expect(merged.find((m) => m.id === 'a3')?.content).toEqual([
        { type: 'text', text: '第三轮 agent 回复（流式更丰）' },
      ])
    })
  })
})
