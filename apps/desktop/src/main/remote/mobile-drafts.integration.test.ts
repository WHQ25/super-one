import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDraftStore } from '@superone/runtime/drafts'
import { DraftControl } from './draft-control'
import { RemoteDraftLibrary } from '../../../../mobile/src/remote-draft-library'

describe('mobile draft outbox against the host', () => {
  let db: Database.Database
  let host: DraftControl
  let mobile: RemoteDraftLibrary
  let online: boolean
  const storage = new Map<string, string>()
  const makeMobile = () => new RemoteDraftLibrary({ key: 'desktop', kv: {
    get: async (key) => storage.get(key) ?? null, set: async (key, value) => { storage.set(key, value) },
  }, request: async (command) => {
    if (!online) throw new Error('offline')
    try { return host.handle(command, 'phone') } catch (error) { return { ok: false, error: (error as Error).message } }
  }, changed() {}, revoked() {} })
  beforeEach(() => { db = new Database(':memory:'); host = new DraftControl(createDraftStore(db)); online = true; storage.clear(); mobile = makeMobile() })
  afterEach(() => db.close())

  it('hides a cleared mobile draft before and after sync, keeps observation control, and permits retyping', async () => {
    host.upsert({ id: 'd', text: 'desktop', projectPath: '/repo' })
    const row = await mobile.open('d')
    await mobile.stage({ ...row, text: '' })
    expect(mobile.rows).toEqual([])
    await mobile.flush('d')
    expect(host.list()).toEqual([])
    expect(host.get('d')).toMatchObject({ text: '', controllerDeviceId: 'phone' })
    expect(db.prepare('SELECT COUNT(*) AS count FROM drafts').get()).toEqual({ count: 0 })
    host.releaseDevice('phone')
    await mobile.reconnect('d')
    expect(host.get('d')?.controllerDeviceId).toBe('phone')
    await mobile.stage({ ...row, text: 'continue' })
    await mobile.flush('d')
    expect(host.get('d')).toMatchObject({ text: 'continue', controllerDeviceId: 'phone' })
    expect(mobile.rows[0].text).toBe('continue')
    await mobile.stage({ ...row, text: '' })
    await mobile.flush('d')
    await mobile.close('d')
    expect(host.get('d')).toBeUndefined()
    expect(mobile.rows).toEqual([])
  })

  it('replays an offline clear after restart without showing or resurrecting an untitled draft', async () => {
    host.upsert({ id: 'd', text: 'desktop', projectPath: '/repo' })
    const row = await mobile.open('d')
    online = false
    await mobile.stage({ ...row, text: '' })
    await expect(mobile.close('d')).rejects.toThrow('offline')
    mobile = makeMobile()
    await mobile.ready
    expect(mobile.rows).toEqual([])
    host.releaseDevice('phone')
    online = true
    await mobile.reconnect(null)
    expect(host.get('d')).toBeUndefined()
    expect(host.list()).toEqual([])
  })

  it('saves, parks, resumes, edits and consumes one shared draft', async () => {
    host.upsert({ id: 'd', text: 'desktop', projectPath: '/repo' })
    await mobile.refresh()
    const row = await mobile.open('d')
    await mobile.stage({ ...row, text: 'phone' })
    await mobile.close('d')
    expect(host.get('d')).toMatchObject({ text: 'phone', controllerDeviceId: null })
    expect((await mobile.open('d')).text).toBe('phone')
    await mobile.remove('d')
    expect(host.list()).toEqual([])
  })
  it('keeps offline edits across a restart and uploads them on reconnect', async () => {
    online = false
    await mobile.stage({ id: 'd', text: 'offline idea', projectPath: '/repo' })
    await expect(mobile.flush('d')).rejects.toThrow('offline')
    mobile = makeMobile()
    await mobile.ready
    expect(mobile.rows[0]).toMatchObject({ text: 'offline idea', pendingSync: true })
    online = true
    await mobile.reconnect(null)
    expect(host.get('d')).toMatchObject({ text: 'offline idea', controllerDeviceId: null })
  })
  it('keeps conflicting offline content instead of overwriting a desktop edit', async () => {
    host.upsert({ id: 'd', text: 'original', projectPath: '/repo' })
    const row = await mobile.open('d')
    await mobile.stage({ ...row, text: 'offline change' })
    host.releaseDevice('phone')
    host.upsert({ id: 'd', text: 'new desktop content', projectPath: '/repo', createdAt: 'later' })
    await expect(mobile.reconnect('d')).rejects.toThrow(/changed/)
    expect(host.get('d')?.text).toBe('new desktop content')
    expect(mobile.rows[0].text).toBe('offline change')
    const recovered = await mobile.open('d')
    expect(recovered.id).not.toBe('d')
    expect(recovered.text).toBe('offline change')
    expect(host.get('d')?.text).toBe('new desktop content')
  })

  it('keeps a locked draft visible when another device refuses its deletion', async () => {
    host.upsert({ id: 'd', text: 'tablet', projectPath: '/repo' })
    host.open('d', 'tablet')
    await mobile.refresh()
    await expect(mobile.remove('d')).rejects.toThrow(/read only/i)
    expect(mobile.rows[0].text).toBe('tablet')
    expect(host.get('d')).toBeDefined()
  })
})
