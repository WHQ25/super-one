import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('../database', () => ({ getDb: () => state.db }))
import { loadSessionHistoryIndex, loadSessionMessageWindow } from './history-navigation'
import { segmentationHistory } from '@superone/chat-view/fixtures/transcript-segmentation'
import { buildCompactBoundaryMessage } from '@superone/shared/compact-boundary'
import type { ChatMessage } from '@superone/shared/agent-types'
let db: DatabaseSync
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  state.db = db
  db.exec(`CREATE TABLE chat_messages (session_id TEXT, id TEXT, sort_order INTEGER, role TEXT, status TEXT,
    content_json TEXT, created_at TEXT, provider_id TEXT, metadata_json TEXT, checkpoint_id TEXT, resume_point_id TEXT)`)
  const insert = db.prepare('INSERT INTO chat_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)')
  for (let i = 0; i < 100; i++) insert.run('s', `m${i}`, i, i % 2 ? 'assistant' : 'user', 'complete',
    JSON.stringify({ content: [{ type: 'text', text: `${i % 2 ? 'Reply' : 'Question'} ${i}` },
      { type: 'thinking', thinking: 'SECRET_REASONING'.repeat(1000) },
      { type: 'tool_use', toolName: 'Bash', input: 'SECRET_TOOL'.repeat(1000) }] }), '', 'claude')
})
afterEach(() => db.close())

describe('history navigation database projection', () => {
  it('returns a full outline without reasoning/tool bodies or full long answers', () => {
    db.prepare('UPDATE chat_messages SET content_json = ? WHERE id = ?').run(JSON.stringify([{ type: 'text', text: 'x'.repeat(10000) }]), 'm1')
    const index = loadSessionHistoryIndex('s')
    expect(index.messageIds).toHaveLength(100)
    expect(index.entries).toHaveLength(100)
    expect(index.entries[0]).toMatchObject({ id: 'm0', index: 0, text: 'Question 0', reply: 'x'.repeat(160) })
    expect(JSON.stringify(index)).not.toMatch(/SECRET_REASONING|SECRET_TOOL/)
    expect(JSON.stringify(index).length).toBeLessThan(30000)
  })
  it('seeks to an old message directly and pages both directions without loading intervening rows', () => {
    expect(loadSessionMessageWindow('s', 'm20', 'around').messages.map(m => m.id)).toEqual(['m18','m19','m20','m21','m22','m23','m24','m25'])
    expect(loadSessionMessageWindow('s', 'm18', 'before').messages.map(m => m.id)).toEqual(['m10','m11','m12','m13','m14','m15','m16','m17'])
    expect(loadSessionMessageWindow('s', 'm25', 'after').messages.map(m => m.id)).toEqual(['m26','m27','m28','m29','m30','m31','m32','m33'])
    expect(loadSessionMessageWindow('s', 'm0', 'before').messages).toEqual([])
    expect(loadSessionMessageWindow('s', 'm99', 'after').messages).toEqual([])
  })
  it('isolates projects through the session id and reports deleted anchors', () => {
    expect(loadSessionHistoryIndex('other').entries).toEqual([])
    expect(() => loadSessionMessageWindow('other', 'm20', 'around')).toThrow('no longer exists')
  })
  it('includes compact markers and visible async-answer rows in navigation', () => {
    db.prepare('UPDATE chat_messages SET provider_id = ?, content_json = ? WHERE id = ?')
      .run('system', JSON.stringify([{ type: 'text', text: '__compact__:auto:100' }]), 'm5')
    db.prepare('UPDATE chat_messages SET id = ? WHERE id = ?').run('codex_async_answer:q', 'm6')
    const index = loadSessionHistoryIndex('s')
    expect(index.compacts).toEqual([{ id: 'm5', index: 5 }])
    expect(index.entries).toHaveLength(99)
    expect(index.entries.find(entry => entry.id === 'codex_async_answer:q')).toMatchObject({
      index: 6, text: 'Question 6', reply: 'Reply 7',
    })
  })
  it('indexes every Codex segment around an async answer using bounded metadata previews', () => {
    const insert = db.prepare('INSERT INTO chat_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)')
    const messages = segmentationHistory(true)
    messages.forEach((message, index) => insert.run('segmented', message.id, index, message.role, message.status,
      JSON.stringify({ content: message.content }), message.createdAt, message.providerId, JSON.stringify(message.metadata ?? {})))
    const index = loadSessionHistoryIndex('segmented')
    expect(index.entries.map(entry => entry.id)).toEqual(['segmented-turn', 'codex_async_answer:question',
      'segmented-turn:after:codex_async_answer:question', 'segmented-turn:segment:final'])
    expect(index.entries.at(-1)?.text).toBe('The production configuration is ready.')
    expect(JSON.stringify(index)).not.toContain('Configuration verified.')
  })
  it('previews each interval after compaction even when a single text block is long and contains emoji', () => {
    const source: ChatMessage = { id: 'source', role: 'assistant', status: 'streaming', providerId: 'claude', createdAt: '',
      content: [{ type: 'text', text: 'Before🙂'.repeat(250) }] }
    const event = { type: 'compact_boundary' as const, trigger: 'auto' as const, preTokens: 100 }
    const first = buildCompactBoundaryMessage(event, 'first', '', source, [source])
    source.content = [{ type: 'text', text: 'Before🙂'.repeat(250) + 'Middle🧠'.repeat(300) }]
    const second = buildCompactBoundaryMessage(event, 'second', '', source, [first, source])
    source.content = [{ type: 'text', text: 'Before🙂'.repeat(250) + 'Middle🧠'.repeat(300) + 'After🦊'.repeat(400) }]
    const insert = db.prepare('INSERT INTO chat_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)')
    ;[first, second, source].forEach((message, index) => insert.run('long', message.id, index, message.role, message.status,
      JSON.stringify({ content: message.content }), '', message.providerId, JSON.stringify(message.metadata ?? {})))
    const index = loadSessionHistoryIndex('long')
    expect(index.entries.map(entry => entry.id)).toEqual(['source', 'source:after:first', 'source:after:second'])
    expect(index.entries.map(entry => entry.text.slice(0, 8))).toEqual(['Before🙂', 'Middle🧠', 'After🦊A'])
    expect(index.entries.every(entry => entry.text.length <= 160)).toBe(true)
    expect(JSON.stringify(index).length).toBeLessThan(2000)
  })
})
