import { describe, expect, it } from 'vitest'
import type { ChatMessage } from './agent-types'
import { buildCompactBoundaryMessage } from './compact-boundary'
import { anchorAsyncAnswer, boundaryCursor } from './transcript-boundary'
import { transcriptSegments, transcriptView } from './transcript-segments'
import { extractTurnOutline } from './turn-outline'
import { extendHistoryIndex } from './session-history-index'
import { withCodexContent } from './codex-content'

const message = (id: string, text: string): ChatMessage => ({ id, role: 'assistant', providerId: 'claude',
  status: 'streaming', createdAt: '', content: [{ type: 'text', text }] })
const compact = (id: string, source: ChatMessage) => buildCompactBoundaryMessage({ type: 'compact_boundary', trigger: 'auto', preTokens: 100 }, id, '', source)
const texts = (messages: ChatMessage[]) => transcriptSegments(messages).map(segment => segment.message.content
  .flatMap(block => block.type === 'text' ? [block.text] : []).join(''))

describe('transcript segmentation at live boundaries', () => {
  it.each(['text', 'thinking', 'legacy'] as const)('keeps a growing %s block intact above accepted async answers after restore', (kind) => {
    const source: ChatMessage = { ...message(`growing-${kind}`, 'Before'), providerId: 'codex' }
    if (kind === 'thinking') source.content = [{ type: 'thinking', thinking: 'Before' }]
    if (kind === 'legacy') {
      source.content = []
      source.metadata = { codex: { threadId: 'thread', usage: null, items: [{ id: 'reply', type: 'agent_message', text: 'Before' }] } }
    }
    const first = anchorAsyncAnswer({ ...message(`codex_async_answer:${kind}-first`, 'Choice'), role: 'user' }, [source])
    const second = anchorAsyncAnswer({ ...message(`codex_async_answer:${kind}-second`, 'Another choice'), role: 'user' }, [source, first])
    const updated: ChatMessage = kind === 'legacy'
      ? { ...source, metadata: { codex: { ...source.metadata!.codex!, items: [{ id: 'reply', type: 'agent_message', text: 'Before and after' }, { id: 'next', type: 'agent_message', text: 'Next block' }] } } }
      : { ...source, content: [kind === 'text' ? { type: 'text', text: 'Before and after' } : { type: 'thinking', thinking: 'Before and after' }, { type: 'text', text: 'Next block' }] }
    const { rows } = transcriptView(JSON.parse(JSON.stringify([updated, first, second])))
    expect(rows.map(row => row.id)).toEqual([source.id, first.id, second.id, `${source.id}:after:${second.id}`])
    expect(rows[0].message.content).toMatchObject([kind === 'thinking'
      ? { type: 'thinking', thinking: 'Before and after' } : { type: 'text', text: 'Before and after' }])
    expect(rows.at(-1)!.message.content).toMatchObject([{ type: 'text', text: 'Next block' }])
  })

  it('does not repeat text when a compaction follows an async answer in the same growing block', () => {
    const source: ChatMessage = { ...message('growing-with-compact', 'Before'), providerId: 'codex' }
    const answer = anchorAsyncAnswer({ ...message('codex_async_answer:compact', 'Choice'), role: 'user' }, [source])
    const marker = compact('after-answer-compact', source)
    const updated: ChatMessage = { ...source, content: [{ type: 'text', text: 'Before and after' }, { type: 'text', text: 'Next block' }] }
    expect(texts([updated, answer, marker])).toEqual(['Before and after', 'Choice', '__compact__:auto:100::', 'Next block'])
  })

  it('keeps two compactions at their exact offsets inside one continued text block after restore', () => {
    const source = message('turn', 'Before')
    const first = compact('c1', source)
    source.content = [{ type: 'text', text: 'BeforeMiddle' }]
    const second = compact('c2', source)
    source.content = [{ type: 'text', text: 'BeforeMiddleAfter' }]
    source.status = 'complete'
    const rows = JSON.parse(JSON.stringify([first, second, source]))
    expect(texts(rows)).toEqual(['Before', '__compact__:auto:100::', 'Middle', '__compact__:auto:100::', 'After'])
    expect(transcriptSegments(rows).map(segment => segment.id)).toEqual(['turn', 'c1', 'turn:after:c1', 'c2', 'turn:after:c2'])
  })

  it('splits immediately after an accepted async answer and keeps later items below the bubble', () => {
    const source = { ...message('turn', ''), providerId: 'codex', metadata: { codex: { threadId: 'thread', usage: null,
      items: [{ id: 'before', type: 'agent_message' as const, text: 'Before' }] } } }
    const answer = anchorAsyncAnswer({ ...message('codex_async_answer:q', 'Choice'), role: 'user' }, [source])
    expect(transcriptSegments([source, answer]).map(segment => segment.id))
      .toEqual(['turn', answer.id, `turn:after:${answer.id}`])
    const updated: ChatMessage = { ...source, metadata: { codex: { ...source.metadata.codex, items: [...source.metadata.codex.items, { id: 'after', type: 'agent_message', text: 'After' }] } } }
    const rows = transcriptSegments([updated, answer])
    expect(rows.map(segment => segment.id)).toEqual(['turn', answer.id, `turn:after:${answer.id}`])
    expect(rows.at(-1)?.message.metadata?.codex?.items.map(item => item.id)).toEqual(['after'])
    expect(rows.at(-1)?.message.status).toBe('streaming')
    expect(rows[0].final).toBe(false)
  })

  it('draws each segment of a derived legacy Codex turn from its own items', () => {
    const source = withCodexContent({ ...message('turn', ''), content: [], providerId: 'codex', metadata: { codex: { threadId: 'thread', usage: null,
      items: [{ id: 'before', type: 'agent_message', text: 'Before' }] } } })
    const answer = anchorAsyncAnswer({ ...message('codex_async_answer:q', 'Choice'), role: 'user' }, [source])
    const updated = withCodexContent({ ...source, metadata: { codex: { ...source.metadata!.codex!, items: [...source.metadata!.codex!.items,
      { id: 'read', type: 'command_execution', command: 'cat a.ts', aggregatedOutput: 'a', status: 'completed', exitCode: 0 },
      { id: 'after', type: 'agent_message', text: 'After' }] } } })
    const rows = transcriptSegments([updated, answer])
    expect(texts([updated, answer])).toEqual(['Before', 'Choice', '', 'After'])
    expect(rows[2].message.content.map(block => block.type)).toEqual(['tool_use', 'tool_result'])
  })

  it('cuts a content-shaped Codex turn by its content', () => {
    const source: ChatMessage = { ...message('turn', 'Before'), providerId: 'codex', metadata: { codex: { threadId: 'thread', usage: null, items: [] } } }
    const first = compact('c1', source)
    const rows = [first, { ...source, status: 'complete' as const, content: [{ type: 'text' as const, text: 'BeforeAfter' }] }]
    expect(texts(rows)).toEqual(['Before', '__compact__:auto:100::', 'After'])
  })

  it('gives separate stable targets to each natural assistant text segment', () => {
    const source = message('turn', 'First')
    source.content.push({ type: 'tool_use', toolUseId: 't', toolName: 'Read', input: '{}', status: 'complete' },
      { type: 'text', text: 'Second' }, { type: 'tool_result', toolUseId: 't', summary: 'Result' })
    const rows = transcriptSegments([source])
    expect(rows).toHaveLength(2)
    expect(rows[0].message.content.some(block => block.type === 'tool_result')).toBe(true)
    const ids = rows.map(segment => segment.id)
    source.content[2] = { type: 'text', text: 'Second grows' }
    expect(transcriptSegments([source]).map(segment => segment.id)).toEqual(ids)
    expect(source.content).toHaveLength(4)
  })
  it('draws natural text segments inside one row, each opened by its text block', () => {
    const source = message('turn', 'First')
    source.content.push({ type: 'thinking', thinking: 'Plan' }, { type: 'text', text: 'Second' },
      { type: 'tool_use', toolUseId: 't', toolName: 'Read', input: '{}', status: 'complete' },
      { type: 'text', text: 'Third' }, { type: 'tool_result', toolUseId: 't', summary: 'Result' })
    const { segments, rows } = transcriptView([source])
    expect(segments).toHaveLength(3)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'turn', source, final: true })
    expect(rows[0].message.content).toEqual(source.content)
    expect([...rows[0].anchors!]).toEqual([[source.content[2], segments[1].id], [source.content[4], segments[2].id]])
  })

  it('cuts rows only where another row sits inside the turn', () => {
    const source = message('turn', 'Before')
    const first = compact('c1', source)
    source.content = [{ type: 'text', text: 'BeforeMiddle' }, { type: 'text', text: 'Next' }]
    source.status = 'complete'
    const { rows } = transcriptView([first, source])
    expect(rows.map(row => row.id)).toEqual(['turn', 'c1', 'turn:after:c1'])
    expect(rows.map(row => row.final)).toEqual([false, true, true])
    const tail = rows[2]
    expect(tail.message.content).toEqual([{ type: 'text', text: 'Middle' }, source.content[1]])
    expect([...tail.anchors!.values()]).toEqual(['turn:segment:text::1'])
    expect(tail.anchors!.has(tail.message.content[1])).toBe(true)
  })

  it('keeps late nested subagent content under the original tool across a later text segment', () => {
    const source = message('turn', 'First')
    source.content.push({ type: 'tool_use', toolUseId: 'root', toolName: 'Agent', input: '{}', status: 'complete' },
      { type: 'text', text: 'Second' },
      { type: 'tool_use', toolUseId: 'nested', toolName: 'Agent', input: '{}', status: 'complete', parentToolUseId: 'root' },
      { type: 'text', text: 'Child result', parentToolUseId: 'nested' })
    const rows = transcriptSegments([source])
    expect(rows).toHaveLength(2)
    expect(rows[0].message.content.some(block => block.type === 'text' && block.text === 'Child result')).toBe(true)
    expect(rows[1].message.content).toEqual([{ type: 'text', text: 'Second' }])
  })

  it('shows legacy markers in their stored order without hiding history', () => {
    const old = message('old', 'Old')
    const marker = compact('c', message('unloaded', 'Unknown'))
    expect(texts([old, marker])).toEqual(['Old', '__compact__:auto:100::'])
  })

  it('orders interleaved answers and compactions by their captured position, including sparse history navigation', () => {
    const source: ChatMessage = { ...message('turn', ''), providerId: 'codex', metadata: { codex: { threadId: 'thread', usage: null,
      items: [{ id: 'before', type: 'agent_message', text: 'Before' }] } } }
    const first = buildCompactBoundaryMessage({ type: 'compact_boundary', trigger: 'auto', preTokens: 100 }, 'c1', '', source, [source])
    const answer = anchorAsyncAnswer({ ...message('codex_async_answer:q', 'Choice'), role: 'user' }, [first, source])
    const second = buildCompactBoundaryMessage({ type: 'compact_boundary', trigger: 'auto', preTokens: 100 }, 'c2', '', source, [first, source, answer])
    const updated: ChatMessage = { ...source, metadata: { codex: { ...source.metadata!.codex!, items: [...source.metadata!.codex!.items, { id: 'after', type: 'agent_message', text: 'After' }] } } }
    const messages = [first, second, updated, answer]
    expect(transcriptSegments(messages).map(segment => segment.id)).toEqual(['turn', 'c1', answer.id, 'c2', 'turn:after:c2'])
    const index = extendHistoryIndex({ messageIds: [], entries: [], compacts: [] }, messages)
    expect(index.entries.map(entry => entry.id)).toEqual(extractTurnOutline(messages).map(entry => entry.id))
    expect(extendHistoryIndex(index, [answer]).entries.map(entry => entry.id)).toEqual(index.entries.map(entry => entry.id))
  })
  it('orders an answer captured before steering ahead of compaction arriving before the RPC returns', () => {
    const source: ChatMessage = { ...message('race-turn', ''), providerId: 'codex', metadata: { codex: { threadId: 'thread', usage: null,
      items: [{ id: 'before', type: 'agent_message', text: 'Before' }] } } }
    const answer = anchorAsyncAnswer({ ...message('codex_async_answer:race', 'Choice'), role: 'user' }, [source])
    const boundary = compact('race-compact', source)
    expect(boundary.metadata!.transcriptBoundary!.order).toBeGreaterThan(answer.metadata!.transcriptBoundary!.order)
    const updated: ChatMessage = { ...source, metadata: { codex: { ...source.metadata!.codex!, items: [...source.metadata!.codex!.items,
      { id: 'after', type: 'agent_message', text: 'After' }] } } }
    const messages = [boundary, updated, answer]
    expect(transcriptSegments(messages).map(segment => segment.id))
      .toEqual(['race-turn', answer.id, boundary.id, 'race-turn:after:race-compact'])
    expect(extendHistoryIndex({ messageIds: [], entries: [], compacts: [] }, messages).entries.map(entry => entry.id))
      .toEqual([answer.id, boundary.id])
  })

  it('keeps late tool results with their pre-compaction call and never duplicates projected reasoning', () => {
    const source = message('turn', 'Before')
    source.content.push({ type: 'tool_use', toolName: 'Read', toolUseId: 't', input: '{}', status: 'complete' })
    const marker = compact('c', source)
    const updated = { ...source, content: [...source.content, { type: 'tool_result' as const, toolUseId: 't', summary: 'Late result' }, { type: 'text' as const, text: 'After' }] }
    const rows = transcriptSegments([marker, updated])
    expect(rows[0].message.content.filter(block => block.type === 'tool_result')).toHaveLength(1)
    expect(rows.at(-1)!.message.content.filter(block => block.type === 'tool_result')).toHaveLength(0)
    const codex: ChatMessage = { ...source, providerId: 'codex', content: [], metadata: { codex: { threadId: 't', usage: null,
      items: [{ id: 'r', type: 'reasoning', text: '', remoteDetail: 'detail' }] } } }
    const boundary = compact('c2', codex)
    const projected = transcriptSegments([boundary, { ...codex }])
    expect(projected.flatMap(row => row.message.metadata?.codex?.items ?? []).filter(item => item.id === 'r')).toHaveLength(1)
  })

  it('keeps a Codex fallback response in the final segment and preserves empty error footers', () => {
    const source: ChatMessage = { ...message('turn', 'Final response'), status: 'complete', providerId: 'codex', metadata: { codex: { threadId: 't', usage: null,
      items: [{ id: 'r', type: 'reasoning', text: 'Before' }, { id: 'a', type: 'agent_message', text: 'Final response' }] } } }
    // Each segment draws what its items derive; the reply shows once, not again as the stored response.
    const segments = transcriptSegments([source])
    expect(segments[0].message.content.map(block => block.type)).toEqual(['thinking'])
    expect(texts([source])).toEqual(['', 'Final response'])
    // Without a reply item, the stored response is the reply.
    const unanswered: ChatMessage = { ...source, metadata: { codex: { ...source.metadata!.codex!, items: [source.metadata!.codex!.items[0]] } } }
    expect(transcriptSegments([unanswered]).at(-1)?.message.content.at(-1)).toEqual(source.content[0])
    const empty = { ...message('failed', ''), content: [], status: 'error' as const }
    expect(transcriptSegments([empty])).toMatchObject([{ id: 'failed', final: true, message: { status: 'error' } }])
  })

  it('places a window cursor where the full compaction boundary sat', () => {
    const source = message('turn', 'Before')
    source.content.push({ type: 'tool_use', toolName: 'Read', toolUseId: 't', input: '{}', status: 'complete' },
      { type: 'tool_result', toolUseId: 't', summary: 'ok' })
    const marker = compact('c1', source)
    source.content = [...source.content, { type: 'text', text: 'After' }]
    source.status = 'complete'
    const boundary = marker.metadata!.transcriptBoundary!
    const cursor = boundaryCursor(boundary, source)
    expect(cursor).toMatchObject({ cursor: true, at: 'text::1', offset: 0, content: {}, items: {} })
    expect(boundaryCursor(cursor, source)).toBe(cursor)
    const slim = { ...marker, metadata: { ...marker.metadata, transcriptBoundary: cursor } }
    expect(texts([slim, source])).toEqual(texts([marker, source]))
    expect(texts([marker, source])).toEqual(['Before', '__compact__:auto:100::', 'After'])
    const { rows } = transcriptView([slim, source])
    expect(rows.map(row => row.id)).toEqual(['turn', 'c1', 'turn:after:c1'])
    expect(rows[0].first).toBe(true)
    expect(rows[1].first).toBeUndefined()
  })

  it('splits a growing text block at the captured offset', () => {
    const source = message('turn', 'Before')
    const marker = compact('c1', source)
    source.content = [{ type: 'text', text: 'BeforeAfter' }]
    const cursor = boundaryCursor(marker.metadata!.transcriptBoundary!, source)
    expect(cursor).toMatchObject({ cursor: true, at: 'text::0', offset: 'Before'.length })
    const slim = { ...marker, metadata: { transcriptBoundary: cursor } }
    expect(texts([slim, source])).toEqual(['Before', '__compact__:auto:100::', 'After'])
  })

  it('keeps the full map when an earlier block grew after a later one was captured', () => {
    const source = message('turn', 'Hi')
    source.content.push({ type: 'tool_use', toolName: 'Read', toolUseId: 't', input: '{}', status: 'complete' })
    const marker = compact('c1', source)
    source.content = [{ type: 'text', text: 'Hi there' }, source.content[1]]
    const boundary = marker.metadata!.transcriptBoundary!
    expect(boundaryCursor(boundary, source)).toBe(boundary)
  })

  it('places a Codex item cursor on the first item past the cut', () => {
    const source: ChatMessage = { ...message('codex-turn', ''), providerId: 'codex', content: [], metadata: { codex: { threadId: 'thread', usage: null,
      items: [{ id: 'before', type: 'agent_message', text: 'Before' }] } } }
    const marker = compact('c1', source)
    const grown: ChatMessage = { ...source, metadata: { codex: { ...source.metadata!.codex!, items: [...source.metadata!.codex!.items,
      { id: 'after', type: 'agent_message', text: 'After' }] } } }
    const cursor = boundaryCursor(marker.metadata!.transcriptBoundary!, grown)
    expect(cursor).toMatchObject({ cursor: true, atItem: 'after', itemOffset: 0, content: {}, items: {} })
    const slim = { ...marker, metadata: { transcriptBoundary: cursor } }
    expect(texts([slim, grown])).toEqual(texts([marker, grown]))
    expect(transcriptView([slim, grown]).rows.map(row => row.id)).toEqual(['codex-turn', 'c1', 'codex-turn:after:c1'])
  })

  it('keeps a folded process below the compaction cursor, even with a character offset', () => {
    const source = message('turn', 'Before')
    const marker = compact('c1', source)
    source.content = [...source.content,
      { type: 'tool_use', toolName: 'Read', toolUseId: 't', input: '{}', status: 'complete' },
      { type: 'tool_result', toolUseId: 't', summary: 'ok' },
      { type: 'text', text: 'After' }]
    const cursor = boundaryCursor(marker.metadata!.transcriptBoundary!, source)
    expect(cursor.at).toBe('tool:t')
    const folded: ChatMessage = { ...source, content: [
      { type: 'text', text: 'Before' },
      { type: 'notice', id: 'fold', level: 'info', kind: 'fold', text: '', fold: {
        fragments: 2, segments: 1, toolCalls: 1, files: [], added: 0, removed: 0,
        contentKey: 'tool:t', messageId: 'turn', key: 'fold:tool:t', revision: '1',
      } },
      { type: 'text', text: 'After' },
    ] }
    const slim = { ...marker, metadata: { transcriptBoundary: { ...cursor, offset: 40 } } }
    const { rows } = transcriptView([slim, folded])
    expect(rows.map(row => row.id)).toEqual(['turn', 'c1', 'turn:after:c1'])
    expect(rows[0].first).toBe(true)
    expect(rows[0].message.content.map(block => block.type)).toEqual(['text'])
    expect(rows[2].message.content.map(block => block.type)).toEqual(['notice', 'text'])
  })

  it('keeps a cleared thinking shell above the compaction cursor', () => {
    const source = message('turn', '')
    source.content = [{ type: 'thinking', thinking: 'Before' }]
    const marker = compact('c1', source)
    const raw: ChatMessage = { ...source, content: [{ type: 'thinking', thinking: 'BeforeAfter' }, { type: 'text', text: 'Next' }] }
    const cursor = boundaryCursor(marker.metadata!.transcriptBoundary!, raw)
    expect(cursor).toMatchObject({ at: 'thinking::0', offset: 'Before'.length })
    const projected: ChatMessage = { ...raw, content: [{ type: 'thinking', thinking: '', remoteDetail: 'think' }, { type: 'text', text: 'Next' }] }
    const { rows } = transcriptView([{ ...marker, metadata: { transcriptBoundary: cursor } }, projected])
    expect(rows.map(row => row.id)).toEqual(['turn', 'c1', 'turn:after:c1'])
    expect(rows[0].message.content[0]).toMatchObject({ type: 'thinking', remoteDetail: 'think' })
    expect(rows[2].message.content).toEqual([{ type: 'text', text: 'Next' }])
  })
})
