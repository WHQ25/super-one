import { expect, it } from 'vitest'
import { memoryKv } from '@superone/relay-client'
import { PersistedWorkspace } from './persisted-workspace'

it('persists bounded values per pairing and serializes Forget after queued writes', async () => {
  const kv = memoryKv()
  const first = new PersistedWorkspace(kv, 'one')
  await first.load()
  first.set('projects', [{ path: '/p' }])
  await first.flush()
  const restarted = new PersistedWorkspace(kv, 'one')
  await restarted.load()
  expect(restarted.get('projects')).toEqual([{ path: '/p' }])
  const other = new PersistedWorkspace(kv, 'two')
  await other.load()
  expect(other.get('projects')).toBeUndefined()
  restarted.set('projects', ['late'])
  await restarted.forget()
  restarted.set('projects', ['ignored'])
  const forgotten = new PersistedWorkspace(kv, 'one')
  await forgotten.load()
  expect(forgotten.get('projects')).toBeUndefined()
})
