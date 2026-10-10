import { expect, test } from 'vitest'
import type { DraftListEntry } from '@superone/shared/environment/draft-rpc'
import { RemoteDraftLibrary } from './remote-draft-library'

function row(id: string): DraftListEntry {
  return {
    id, title: id, text: id, docJson: null, attachments: [], projectPath: '/repo', harness: null, model: null,
    permissionMode: null, settings: {}, originSessionId: null, createdAt: 'then', updatedAt: 'then',
  }
}

test('reconnect drops a draft the desktop sent while the phone was away', async () => {
  const host = new Map([['sent', row('sent')], ['kept', row('kept')]])
  const storage = new Map<string, string>()
  const library = new RemoteDraftLibrary({
    kv: { get: async (key) => storage.get(key) ?? null, set: async (key, value) => { storage.set(key, value) } },
    key: 'drafts',
    rpc: async (method) => method === 'draft.list' ? { drafts: [...host.values()] } : { ok: true },
    changed: () => {},
    revoked: () => {},
  })
  await library.refresh()
  expect(library.rows.map((draft) => draft.id).sort()).toEqual(['kept', 'sent'])

  // The `draft_changed` for this delete never reached the phone.
  host.delete('sent')
  await library.reconnect(null)

  expect(library.rows.map((draft) => draft.id)).toEqual(['kept'])
})

test('a native topic snapshot removes stale host rows and preserves unsent phone edits', async () => {
  const library = new RemoteDraftLibrary({
    kv: { get: async () => null, set: async () => {} }, key: 'drafts',
    rpc: async () => ({}), changed: () => {}, revoked: () => {},
  })
  await library.ready
  library.ingestSnapshot([row('stale'), row('kept')])
  await library.stage({ ...row('local'), text: 'unsent phone edit' })
  library.ingestSnapshot([row('kept')])
  expect(library.rows.map(draft => draft.id).sort()).toEqual(['kept', 'local'])
  expect(library.get('local')?.text).toBe('unsent phone edit')
})

test('a native snapshot revokes a locally held draft that disappeared', async () => {
  const revoked: string[] = []
  const draft = { ...row('held'), controllerDeviceId: 'phone' }
  const library = new RemoteDraftLibrary({
    kv: { get: async () => null, set: async () => {} }, key: 'drafts',
    rpc: async () => ({ draft, leaseId: 'lease' }), changed: () => {}, revoked: id => revoked.push(id),
  })
  await library.open('held')
  library.ingestSnapshot([])
  expect(revoked).toEqual(['held'])
  expect(library.get('held')).toBeUndefined()
})

test('a native snapshot revokes a locally held draft taken by another controller', async () => {
  const revoked: string[] = []
  const draft = { ...row('held'), controllerDeviceId: 'phone' }
  const library = new RemoteDraftLibrary({
    kv: { get: async () => null, set: async () => {} }, key: 'drafts',
    rpc: async () => ({ draft, leaseId: 'lease' }), changed: () => {}, revoked: id => revoked.push(id),
  })
  await library.open('held')
  library.ingestSnapshot([{ ...draft, controllerDeviceId: 'other' }])
  expect(revoked).toEqual(['held'])
  expect(library.get('held')?.controllerDeviceId).toBe('other')
})

test('a late draft-list response cannot resurrect rows removed by a newer native snapshot', async () => {
  let finish!: (value: { drafts: DraftListEntry[] }) => void
  const pending = new Promise<{ drafts: DraftListEntry[] }>(resolve => { finish = resolve })
  const library = new RemoteDraftLibrary({
    kv: { get: async () => null, set: async () => {} }, key: 'drafts',
    rpc: async () => pending, changed: () => {}, revoked: () => {},
  })
  await library.ready
  const refreshing = library.refresh()
  await new Promise(resolve => setTimeout(resolve, 0))
  library.ingestSnapshot([row('kept')])
  finish({ drafts: [row('stale'), row('kept')] })
  await refreshing
  expect(library.rows.map(draft => draft.id)).toEqual(['kept'])
})
