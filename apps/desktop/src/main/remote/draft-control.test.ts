import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDraftStore } from '@superone/runtime/drafts'
import { DraftControl } from './draft-control'

describe('shared desktop and mobile drafts', () => {
  let db: Database.Database
  let drafts: DraftControl
  beforeEach(() => {
    db = new Database(':memory:')
    drafts = new DraftControl(createDraftStore(db))
    drafts.upsert({ id: 'draft', text: 'desktop text', projectPath: '/project', originSessionId: 'origin' })
  })
  afterEach(() => db.close())

  it('locks local writes while a phone edits, then retains its latest content on disconnect', () => {
    const opened = drafts.open('draft', 'phone')
    expect(opened.draft.text).toBe('desktop text')
    expect(() => drafts.upsert({ id: 'draft', text: 'stale desktop text' })).toThrow(/read only/i)
    expect(() => drafts.delete('draft')).toThrow(/read only/i)
    drafts.save({ ...opened.draft, text: 'phone text' }, 'phone', opened.leaseId)
    drafts.disconnect('draft')
    expect(drafts.get('draft')?.text).toBe('phone text')
    expect(() => drafts.save({ ...opened.draft, text: 'late packet' }, 'phone', opened.leaseId)).toThrow(/control/i)
    drafts.upsert({ id: 'draft', text: 'desktop resumed' })
    expect(drafts.get('draft')?.text).toBe('desktop resumed')
  })

  it('protects another phone and the original session from stale writes using a new id', () => {
    drafts.open('draft', 'phone')
    expect(() => drafts.open('draft', 'tablet')).toThrow(/read only/i)
    expect(() => drafts.upsert({ id: 'other', originSessionId: 'origin', text: 'stale' })).toThrow(/read only/i)
    expect(drafts.get('draft')).toBeDefined()
  })

  it('releases only the disconnected device and publishes content, control and deletion changes', () => {
    const changes: unknown[] = []
    drafts.watch((event) => changes.push(event))
    const opened = drafts.open('draft', 'phone')
    drafts.releaseDevice('tablet')
    expect(drafts.get('draft')?.controllerDeviceId).toBe('phone')
    drafts.releaseDevice('phone')
    expect(drafts.get('draft')?.controllerDeviceId).toBeNull()
    expect(() => drafts.save(opened.draft, 'phone', opened.leaseId)).toThrow(/control/i)
    drafts.delete('draft')
    expect(changes).toMatchObject([
      { type: 'draft_changed', draftId: 'draft', draft: { controllerDeviceId: 'phone' } },
      { type: 'draft_changed', draftId: 'draft', draft: { controllerDeviceId: null } },
      { type: 'draft_changed', draftId: 'draft', draft: null },
    ])
  })
})
