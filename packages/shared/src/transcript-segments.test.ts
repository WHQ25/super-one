import { describe, expect, it } from 'vitest'
import type { ChatMessage } from './agent-types'
import { buildCompactBoundaryMessage } from './compact-boundary'
import { anchorAsyncAnswer } from './transcript-boundary'
import { transcriptSegments } from './transcript-segments'
import { extractTurnOutline } from './turn-outline'
import { extendHistoryIndex } from './session-history-index'

const message = (id: string, text: string): ChatMessage => ({ id, role: 'assistant', providerId: 'claude',
  status: 'streaming', createdAt: '', content: [{ type: 'text', text }] })
const compact = (id: string, source: ChatMessage) => buildCompactBoundaryMessage({ type: 'compact_boundary', trigger: 'auto', preTokens: 100 }, id, '', source)
const texts = (messages: ChatMessage[]) => transcriptSegments(messages).map(segment => segment.message.content
  .flatMap(block => block.type === 'text' ? [block.text] : []).join(''))

describe('transcript segmentation at live boundaries', () => {
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
      .toEqual(['race-turn', answer.id, 'race-turn:after:race-compact'])
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
    const segments = transcriptSegments([source])
    expect(segments[0].message.content).toEqual([])
    expect(segments.at(-1)?.message.content).toEqual(source.content)
    const empty = { ...message('failed', ''), content: [], status: 'error' as const }
    expect(transcriptSegments([empty])).toMatchObject([{ id: 'failed', final: true, message: { status: 'error' } }])
  })
})
