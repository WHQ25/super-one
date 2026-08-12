import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

function canOpenBetterSqlite(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const db = new Database(':memory:')
    db.close()
    return true
  } catch {
    // Host Node ABI ≠ Electron-rebuilt better-sqlite3 (postinstall).
    return false
  }
}

const describeStore = canOpenBetterSqlite() ? describe : describe.skip

describeStore('BetterSqliteLocalAgentStore', () => {
  let dir: string
  // dynamic import after ABI check so require doesn't throw at collection time
  let BetterSqliteLocalAgentStore: typeof import('./cursor-store').BetterSqliteLocalAgentStore
  let store: import('./cursor-store').BetterSqliteLocalAgentStore

  afterEach(() => {
    store?.dispose()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('creates, lists, and deletes agents', async () => {
    ;({ BetterSqliteLocalAgentStore } = await import('./cursor-store'))
    dir = mkdtempSync(join(tmpdir(), 'cursor-store-'))
    store = new BetterSqliteLocalAgentStore(join(dir, 'agent-store.db'))
    const now = Date.now()
    await store.agents.create({
      agent: {
        agentId: 'a1',
        cwd: '/tmp/proj',
        status: 'idle',
        createdAt: now,
        updatedAt: now,
      },
    })
    const got = await store.agents.get({ agentId: 'a1' })
    expect(got?.cwd).toBe('/tmp/proj')
    const list = await store.agents.list({ filter: { cwd: '/tmp/proj' } })
    expect(list.items).toHaveLength(1)
    await store.agents.delete({ filter: { agentIds: ['a1'] } })
    expect(await store.agents.get({ agentId: 'a1' })).toBeNull()
  })

  it('stores checkpoint blobs and run events', async () => {
    ;({ BetterSqliteLocalAgentStore } = await import('./cursor-store'))
    dir = mkdtempSync(join(tmpdir(), 'cursor-store-'))
    store = new BetterSqliteLocalAgentStore(join(dir, 'agent-store.db'))
    const now = Date.now()
    await store.agents.create({
      agent: {
        agentId: 'a1',
        cwd: '/tmp/proj',
        status: 'idle',
        createdAt: now,
        updatedAt: now,
      },
    })
    const data = new Uint8Array([1, 2, 3])
    await store.checkpoints.create({ agentId: 'a1', blobId: 'b1', data })
    expect(await store.checkpoints.get({ agentId: 'a1', blobId: 'b1' })).toEqual(data)

    await store.runs.create({
      run: {
        runId: 'r1',
        agentId: 'a1',
        turnNumber: 1,
        status: 'finished',
        createdAt: now,
        updatedAt: now,
      },
    })
    const ev = await store.runEvents.append({
      runId: 'r1',
      eventType: 'sdk_message',
      payload: { hello: true },
    })
    expect(ev.seq).toBe(1)
    const page = await store.runEvents.list({ runId: 'r1' })
    expect(page.items).toHaveLength(1)
  })
})
