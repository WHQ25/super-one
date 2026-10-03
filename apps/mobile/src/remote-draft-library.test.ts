import { expect, test } from 'vitest'
import type { DraftListEntry, DraftRemoteCommand } from '@superone/shared/environment/draft-rpc'
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
    request: async (command: DraftRemoteCommand) => command.type === 'list_drafts' ? { drafts: [...host.values()] } : { ok: true },
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
