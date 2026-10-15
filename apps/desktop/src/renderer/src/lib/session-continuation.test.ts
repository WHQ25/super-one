/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'
import { createDefaultPerSessionState } from '@/stores/chat-store/defaults'
import { continuationDraft } from './session-continuation'

describe('continuationDraft', () => {
  it('opens with a mention of the old session and keeps its unsent draft after it', () => {
    const session = {
      ...createDefaultPerSessionState(),
      draftText: 'and fix the tests',
      draftJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'and fix the tests' }] }] },
      mentions: [{ kind: 'file' as const, value: 'src/a.ts', displayName: 'a.ts' }],
    }

    const draft = continuationDraft({ sessionId: 'old', title: 'Refactor', session })

    expect(draft.draftText).toBe('@Refactor and fix the tests')
    expect(draft.draftJson).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'mention', attrs: { kind: 'session', value: 'old', displayName: 'Refactor' } }, { type: 'text', text: ' ' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'and fix the tests' }] },
      ],
    })
    expect(draft.mentions).toEqual([
      { kind: 'session', value: 'old', displayName: 'Refactor' },
      { kind: 'file', value: 'src/a.ts', displayName: 'a.ts' },
    ])
  })

  it('holds only the mention when there was no draft', () => {
    const draft = continuationDraft({ sessionId: 'old', title: 'Refactor', session: createDefaultPerSessionState() })

    expect(draft.draftText).toBe('@Refactor')
    expect((draft.draftJson as { content: unknown[] }).content).toHaveLength(1)
  })
})
