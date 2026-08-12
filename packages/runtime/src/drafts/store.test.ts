import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { createDraftStore } from './store'

const dbs: Database.Database[] = []

afterEach(() => {
  while (dbs.length) {
    try {
      dbs.pop()?.close()
    } catch {
      /* ignore */
    }
  }
})

function openStore() {
  const db = new Database(':memory:')
  dbs.push(db)
  return createDraftStore(db)
}

describe('draft store', () => {
  it('returns the stored draft with a title derived from the first meaningful line', () => {
    const store = openStore()
    const saved = store.upsert({ id: 'd1', text: '\n\n  fix the relay ACK bug\nmore detail here' })
    expect(saved.title).toBe('fix the relay ACK bug')
    expect(store.list()).toHaveLength(1)
  })

  it('upserting the same id updates in place instead of inserting a second row', () => {
    const store = openStore()
    const first = store.upsert({ id: 'd1', text: 'first' })
    const second = store.upsert({ id: 'd1', text: 'second' })
    expect(store.list()).toHaveLength(1)
    expect(second.text).toBe('second')
    expect(second.createdAt).toBe(first.createdAt)
  })

  it('reassigns originSessionId when a different draft claims it, keeping one draft per unsent session', () => {
    const store = openStore()
    store.upsert({ id: 'd1', text: 'a', originSessionId: 's1' })
    store.upsert({ id: 'd2', text: 'b', originSessionId: 's1' })
    const rows = store.list()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('d2')
  })

  it('keeps multiple drafts with no origin session', () => {
    const store = openStore()
    store.upsert({ id: 'd1', text: 'a' })
    store.upsert({ id: 'd2', text: 'b' })
    expect(store.list()).toHaveLength(2)
  })

  it('lists newest first and filters by project path', () => {
    const store = openStore()
    store.upsert({ id: 'd1', text: 'a', projectPath: '/x', createdAt: '2026-01-01T00:00:00.000Z' })
    store.upsert({ id: 'd2', text: 'b', projectPath: '/y' })
    store.upsert({ id: 'd3', text: 'c', projectPath: '/x' })
    expect(store.list().map((d) => d.id)).toEqual(['d3', 'd2', 'd1'])
    expect(store.list('/x').map((d) => d.id)).toEqual(['d3', 'd1'])
  })

  it('round-trips doc json, attachments, target fields and full session settings', () => {
    const store = openStore()
    const saved = store.upsert({
      id: 'd1',
      text: 'hello',
      docJson: { type: 'doc', content: [] },
      attachments: [{ name: 'shot.png', mimeType: 'image/png', data: 'AAA' }],
      projectPath: '/repo',
      harness: 'codex',
      model: 'gpt-5',
      permissionMode: 'plan',
      settings: {
        harness: 'codex',
        codexModel: 'gpt-5',
        codexReasoningEffort: 'high',
        codexPermissionPreset: 'full-access',
        codexCollaborationMode: 'plan',
        permissionMode: 'plan',
        worktreePath: '/repo/.worktrees/feat',
        gitBranch: 'feat/ack',
        pendingBaseBranch: 'main',
        pendingWorktreeMode: 'branch',
        pendingBranchName: 'feat/ack',
        pendingCarryLocalChanges: true,
        sandboxEnabled: true,
        sandboxAutoAllowBash: false,
        additionalDirs: ['/tmp/extra'],
      },
    })
    expect(saved.docJson).toEqual({ type: 'doc', content: [] })
    expect(saved.attachments[0].name).toBe('shot.png')
    expect(saved.harness).toBe('codex')
    expect(saved.settings.codexReasoningEffort).toBe('high')
    expect(saved.settings.worktreePath).toBe('/repo/.worktrees/feat')
    expect(saved.settings.gitBranch).toBe('feat/ack')
    expect(saved.settings.pendingBaseBranch).toBe('main')
    expect(saved.settings.pendingWorktreeMode).toBe('branch')
    expect(saved.settings.pendingBranchName).toBe('feat/ack')
    expect(saved.settings.sandboxEnabled).toBe(true)
    const loaded = store.get('d1')
    expect(loaded).toEqual(saved)
  })

  it('drops attachments that blow the size budget rather than refusing the draft', () => {
    const store = openStore()
    const huge = 'x'.repeat(9 * 1024 * 1024)
    const saved = store.upsert({
      id: 'd1',
      text: 'keep my text',
      attachments: [{ name: 'big.png', mimeType: 'image/png', data: huge }],
    })
    expect(saved.text).toBe('keep my text')
    expect(saved.attachments).toEqual([])
  })

  it('deletes by id and reports whether a row was removed', () => {
    const store = openStore()
    store.upsert({ id: 'd1', text: 'a' })
    expect(store.delete('d1')).toBe(true)
    expect(store.delete('d1')).toBe(false)
    expect(store.list()).toHaveLength(0)
  })
})
