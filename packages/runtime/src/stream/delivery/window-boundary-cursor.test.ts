import { describe, expect, it } from 'vitest'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { buildCompactBoundaryMessage } from '@superone/shared/compact-boundary'
import { utf8Length } from '@superone/shared/transcript-window/content-digest'
import { MAX_META_BYTES } from '@superone/shared/transcript-window/fragment-message'
import { applyWindowPatch, applyWindowResult, EMPTY_WINDOW_LOOKUP, materializeWindowMessage } from '@superone/shared/transcript-window/window-store'
import { contentKeyStamp } from '@superone/shared/transcript-boundary'
import { transcriptView } from '@superone/shared/transcript-segments'
import { longReplyText, textMessage } from '@superone/shared/transcript-window/window-fixtures'
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

  it('keeps compaction markers between the closed prefix and the streaming tail', () => {
    const user = textMessage('user', 'user', '排查远程节点')
    const before = textMessage('turn', 'assistant', 'Before the compaction.', 'streaming')
    const first = buildCompactBoundaryMessage({ type: 'compact_boundary', trigger: 'auto', preTokens: 100 }, 'c1', '', before)
    const middle = { ...before, content: [...before.content, { type: 'text' as const, text: 'Between the compactions.' }] }
    const second = buildCompactBoundaryMessage({ type: 'compact_boundary', trigger: 'auto', preTokens: 120 }, 'c2', '', middle, [first])
    const assistant = { ...middle, content: [...middle.content, { type: 'text' as const, text: `After both. ${longReplyText(80 * 1024)}` }] }
    const views = new WindowViews()
    const budget = { maxBytes: 64 * 1024, maxFragments: 24, targetChars: 6000 }
    const served = views.serve({
      sessionId: 's', holder: 'phone', messages: [user, before], request: { folds: true }, budget,
    })
    const held = applyWindowResult(null, served, EMPTY_WINDOW_LOOKUP).state
    const patches = views.patches('s', [user, first, second, assistant])
    expect(patches).toHaveLength(1)
    const tail = patches[0].patch.messages.find((row) => row.id === 'turn')
    expect(tail?.omittedBefore).toBeGreaterThan(0)
    expect(tail?.fragments.some((fragment) => fragment.contentKey === 'text::0')).toBe(true)
    expect(tail?.fragments.some((fragment) => fragment.contentKey === 'text::1')).toBe(true)
    expect(tail?.fragments.some((fragment) => fragment.contentKey === 'text::2')).toBe(true)

    const next = applyWindowPatch(held, patches[0].patch).state
    const painted = next.messages.map(materializeWindowMessage)
    const rows = transcriptView(painted).rows
    expect(rows.map((row) => row.id)).toEqual(['user', 'turn', 'c1', 'turn:after:c1', 'c2', 'turn:after:c2'])
    expect(rows.find((row) => row.id === 'turn:after:c2')?.message.status).toBe('streaming')
    expect(rows.find((row) => row.id === 'turn')?.message.status).toBe('complete')
    const textOf = (id: string) => rows.find((row) => row.id === id)?.message.content
      .flatMap((block) => block.type === 'text' ? [block.text] : []).join('')
    expect(textOf('turn')).toBe('Before the compaction.')
    expect(textOf('turn:after:c1')).toBe('Between the compactions.')
    expect(textOf('c1')).toContain('__compact__')
    expect(textOf('c2')).toContain('__compact__')
    const tailText = textOf('turn:after:c2')
    expect(tailText.length).toBeGreaterThan(1000)
    expect(tailText).not.toContain('After both.')
    expect(painted.find((row) => row.id === 'turn')?.content.some((block) => contentKeyStamp(block)?.key === 'text::2')).toBe(true)
  })

  it('folds the process before each compaction and streams only the open suffix', () => {
    const user = textMessage('user', 'user', 'go')
    const bashPairs = (start: number) => Array.from({ length: 4 }, (_, offset) => {
      const toolUseId = `bash_${start + offset}`
      return [
        { type: 'tool_use' as const, toolName: 'Bash', toolUseId, input: JSON.stringify({ command: `echo ${toolUseId}` }), status: 'complete' as const },
        { type: 'tool_result' as const, toolUseId, summary: 'ok' },
      ]
    }).flat()
    const firstTools = bashPairs(0)
    const opened: ChatMessage = {
      id: 'turn', role: 'assistant', status: 'streaming', createdAt: '', providerId: 'claude', content: firstTools,
    }
    const first = buildCompactBoundaryMessage({ type: 'compact_boundary', trigger: 'auto', preTokens: 100 }, 'c1', '', opened)
    const secondTools = bashPairs(4)
    const middle: ChatMessage = { ...opened, content: [...firstTools, ...secondTools] }
    const second = buildCompactBoundaryMessage({ type: 'compact_boundary', trigger: 'auto', preTokens: 120 }, 'c2', '', middle, [first])
    const assistant: ChatMessage = { ...middle, content: [...middle.content, { type: 'text', text: `After both. ${longReplyText(80 * 1024)}` }] }
    const views = new WindowViews()
    const served = views.serve({
      sessionId: 's', holder: 'phone', messages: [user, opened], request: { folds: true }, budget: { maxBytes: 64 * 1024, maxFragments: 24, targetChars: 6000 },
    })
    const held = applyWindowResult(null, served, EMPTY_WINDOW_LOOKUP).state
    const patches = views.patches('s', [user, first, second, assistant])
    expect(patches).toHaveLength(1)
    const next = applyWindowPatch(held, patches[0].patch).state
    const rows = transcriptView(next.messages.map(materializeWindowMessage)).rows
    expect(rows.map((row) => row.id)).toEqual(['user', 'turn', 'c1', 'turn:after:c1', 'c2', 'turn:after:c2'])
    const fold = (id: string) => rows.find((row) => row.id === id)?.message.content.find((block) => block.type === 'notice' && block.kind === 'fold')
    expect(fold('turn')).toMatchObject({ type: 'notice', kind: 'fold' })
    expect(fold('turn:after:c1')).toMatchObject({ type: 'notice', kind: 'fold' })
    const tail = rows.find((row) => row.id === 'turn:after:c2')
    expect(tail?.message.status).toBe('streaming')
    expect(tail?.message.content.some((block) => block.type === 'notice' && block.kind === 'fold')).toBe(false)
    expect(tail?.message.content.some((block) => block.type === 'text' && block.text.length > 1000)).toBe(true)
    expect(tail?.message.content.some((block) => block.type === 'tool_use')).toBe(false)
  })

  it('keeps compaction rows on a cold open when the streaming reply fills the fragment budget', () => {
    const user = textMessage('user', 'user', 'go')
    const bashPairs = (start: number) => Array.from({ length: 4 }, (_, offset) => {
      const toolUseId = `bash_${start + offset}`
      return [
        { type: 'tool_use' as const, toolName: 'Bash', toolUseId, input: JSON.stringify({ command: `echo ${toolUseId}` }), status: 'complete' as const },
        { type: 'tool_result' as const, toolUseId, summary: 'ok' },
      ]
    }).flat()
    const opened: ChatMessage = {
      id: 'turn', role: 'assistant', status: 'streaming', createdAt: '', providerId: 'claude', content: bashPairs(0),
    }
    const first = buildCompactBoundaryMessage({ type: 'compact_boundary', trigger: 'auto', preTokens: 100 }, 'c1', '', opened)
    const middle: ChatMessage = { ...opened, content: [...opened.content, ...bashPairs(4)] }
    const second = buildCompactBoundaryMessage({ type: 'compact_boundary', trigger: 'auto', preTokens: 120 }, 'c2', '', middle, [first])
    const assistant: ChatMessage = { ...middle, content: [...middle.content, { type: 'text', text: `After both. ${longReplyText(80 * 1024)}` }] }
    const served = new WindowViews().serve({
      sessionId: 's', holder: 'phone', messages: [user, first, second, assistant], request: { folds: true },
      budget: { maxBytes: 128 * 1024, maxFragments: 2, targetChars: 100 },
    })
    expect(served.messages.map((row) => row.id)).toEqual(['c1', 'c2', 'turn'])
    expect(served.messages.find((row) => row.id === 'c1')?.meta?.metadata?.transcriptBoundary).toMatchObject({ cursor: true })
    const rows = transcriptView(applyWindowResult(null, served, EMPTY_WINDOW_LOOKUP).state.messages.map(materializeWindowMessage)).rows
    expect(rows.map((row) => row.id)).toEqual(['turn', 'c1', 'turn:after:c1', 'c2', 'turn:after:c2'])
    const fold = (id: string) => rows.find((row) => row.id === id)?.message.content.find((block) => block.type === 'notice' && block.kind === 'fold')
    expect(fold('turn')).toMatchObject({ type: 'notice', kind: 'fold' })
    expect(fold('turn:after:c1')).toMatchObject({ type: 'notice', kind: 'fold' })
    expect(rows.find((row) => row.id === 'turn:after:c2')?.message.status).toBe('streaming')
  })
})
