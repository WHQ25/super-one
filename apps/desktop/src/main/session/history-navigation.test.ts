import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('../database', () => ({ getDb: () => state.db }))
import { loadSessionHistoryIndex, loadSessionMessageWindow } from './history-navigation'
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
    expect(index.entries).toHaveLength(50)
    expect(index.entries[0]).toMatchObject({ id: 'm0', index: 0, text: 'Question 0', reply: 'x'.repeat(160) })
    expect(JSON.stringify(index)).not.toMatch(/SECRET_REASONING|SECRET_TOOL/)
    expect(JSON.stringify(index).length).toBeLessThan(9000)
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
  it('includes compact markers but excludes hidden async-answer rows from ticks', () => {
    db.prepare('UPDATE chat_messages SET provider_id = ?, content_json = ? WHERE id = ?')
      .run('system', JSON.stringify([{ type: 'text', text: '__compact__:auto:100' }]), 'm5')
    db.prepare('UPDATE chat_messages SET id = ? WHERE id = ?').run('codex_async_answer:q', 'm6')
    const index = loadSessionHistoryIndex('s')
    expect(index.compacts).toEqual([{ id: 'm5', index: 5 }])
    expect(index.entries).toHaveLength(49)
  })
})
