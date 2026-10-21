import { describe, expect, it } from 'vitest'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { buildCompactBoundaryMessage } from '@superone/shared/compact-boundary'
import { utf8Length } from '@superone/shared/transcript-window/content-digest'
import { MAX_META_BYTES } from '@superone/shared/transcript-window/fragment-message'
import { applyWindowPatch, applyWindowResult, EMPTY_WINDOW_LOOKUP, materializeWindowMessage } from '@superone/shared/transcript-window/window-store'
import { transcriptView } from '@superone/shared/transcript-segments'
import { textMessage } from '@superone/shared/transcript-window/window-fixtures'
import { WindowViews } from './window-views'

const budget = { maxBytes: 2 * 1024 * 1024, maxFragments: 2000, targetChars: 100_000 }

function toolPairs(start: number, count: number): ContentBlock[] {
  return Array.from({ length: count }, (_, offset) => {
    const toolUseId = `call_${String(start + offset).padStart(4, '0')}_${'x'.repeat(36)}`
    return [
      { type: 'tool_use' as const, toolName: 'Read', toolUseId, input: '{}', status: 'complete' as const },
      { type: 'tool_result' as const, toolUseId, summary: 'ok' },
    ]
  }).flat()
}

describe('compaction boundary cursor', () => {
  it('serves a boundary larger than the meta ceiling as a cursor that still splits the turn', () => {
    const before = 'Before the compaction point.'
    const assistant: ChatMessage = {
      id: 'turn', role: 'assistant', status: 'complete', createdAt: '', providerId: 'claude',
      content: [{ type: 'text', text: before }, ...toolPairs(0, 200)],
    }
    const marker = buildCompactBoundaryMessage({ type: 'compact_boundary', trigger: 'auto', preTokens: 100 }, 'compact', '', assistant)
    assistant.content = [...assistant.content, { type: 'text', text: 'After it continues.' }, ...toolPairs(200, 40)]
    const { content: _content, ...fullMeta } = marker
    expect(utf8Length(JSON.stringify(fullMeta))).toBeGreaterThan(MAX_META_BYTES)

    const served = new WindowViews().serve({
      sessionId: 's', holder: 'phone', messages: [marker, assistant], request: { folds: true }, budget,
    })
    const compact = served.messages.find((row) => row.id === 'compact')
    expect(compact?.meta?.metadata?.transcriptBoundary).toMatchObject({
      cursor: true, messageId: 'turn', at: 'text::1', offset: 0, content: {}, items: {},
    })
    expect(utf8Length(JSON.stringify(compact?.meta))).toBeLessThanOrEqual(MAX_META_BYTES)
    expect(marker.metadata?.transcriptBoundary?.cursor).toBeUndefined()
    expect(Object.keys(marker.metadata?.transcriptBoundary?.content ?? {}).length).toBeGreaterThan(300)

    const held = applyWindowResult(null, served, EMPTY_WINDOW_LOOKUP).state
    const rows = transcriptView(held.messages.map(materializeWindowMessage)).rows
    expect(rows.map((row) => row.id)).toEqual(['turn', 'compact', 'turn:after:compact'])
    expect(rows[0].first).toBe(true)
    expect(rows.map((row) => row.message.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('')))
      .toEqual([before, '__compact__:auto:100::', 'After it continues.'])
  })

  it('moves the cursor when the turn grows after the compact row was already served', () => {
    const assistant = textMessage('turn', 'assistant', 'Before')
    const marker = buildCompactBoundaryMessage({ type: 'compact_boundary', trigger: 'auto', preTokens: 100 }, 'compact', '', assistant)
    const views = new WindowViews()
    const served = views.serve({
      sessionId: 's', holder: 'phone', messages: [marker, assistant], request: { folds: true }, budget,
    })
    expect(served.messages.find((row) => row.id === 'compact')?.meta?.metadata?.transcriptBoundary).toMatchObject({ cursor: true })
    expect(served.messages.find((row) => row.id === 'compact')?.meta?.metadata?.transcriptBoundary?.at).toBeUndefined()

    const grown = { ...assistant, content: [...assistant.content, { type: 'text' as const, text: 'After it continues.' }] }
    const patches = views.patches('s', [marker, grown])
    expect(patches).toHaveLength(1)
    const patched = patches[0].patch.messages.find((row) => row.id === 'compact')
    expect(patched?.meta?.metadata?.transcriptBoundary).toMatchObject({ cursor: true, at: 'text::1', offset: 0 })

    const opened = applyWindowResult(null, served, EMPTY_WINDOW_LOOKUP).state
    const next = applyWindowPatch(opened, patches[0].patch).state
    const rows = transcriptView(next.messages.map(materializeWindowMessage)).rows
    expect(rows.map((row) => row.id)).toEqual(['turn', 'compact', 'turn:after:compact'])
    expect(rows.map((row) => row.message.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('')))
      .toEqual(['Before', '__compact__:auto:100::', 'After it continues.'])
  })
})
