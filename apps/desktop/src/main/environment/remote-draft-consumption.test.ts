import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false },
  app: { getPath: () => electron.userData, getVersion: () => '0.0.0-test' },
}))
const database = vi.hoisted(() => ({ getDb: vi.fn() }))
vi.mock('../database', () => ({ getDb: database.getDb }))
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, mobileLog: vi.fn() }))

import { startNodeRuntime, type NodeRuntime } from '../../../../../apps/cli/src/runtime'
import { EnvironmentHost, resetEnvironmentHostForTests } from './environment-host'

let host: EnvironmentHost | undefined
let runtime: NodeRuntime | undefined
let db: Database.Database | undefined
const dirs: string[] = []

afterEach(async () => {
  host?.dispose()
  host = undefined
  resetEnvironmentHostForTests()
  await runtime?.stop()
  runtime = undefined
  db?.close()
  db = undefined
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('consuming a remote draft', () => {
  it('deletes an opened draft under its lease after the message reaches the node', async () => {
    const [userData, nodeHome, projectDir] = ['draft-controller-', 'draft-node-', 'draft-project-']
      .map((prefix) => mkdtempSync(join(tmpdir(), prefix)))
    dirs.push(userData!, nodeHome!, projectDir!)
    electron.userData = userData!
    db = new Database(':memory:')
    db.exec(`CREATE TABLE pending_drafts (
      id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, payload_json TEXT NOT NULL,
      queued_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT
    )`)
    database.getDb.mockReturnValue(db)
    runtime = await startNodeRuntime({ nodeHome: nodeHome!, bindHost: '127.0.0.1', bindPort: 0, simulatedHarness: true })
    host = new EnvironmentHost(userData!)
    const { connectionId, descriptor } = await host.pairRemote({
      baseUrl: runtime.server.url, pairingToken: runtime.auth.createPairingToken().token, label: 'draft-node',
    })
    const project = await host.getGateway(descriptor.environmentId)!.openProject(projectDir!)
    await host.upsertDraft(connectionId, {
      id: 'saved-draft', text: 'send this message', projectPath: projectDir!, originSessionId: 'composer-id',
    })
    const opened = await host.openDraft(connectionId, 'saved-draft')
    const created = await host.createSession(connectionId, { projectId: project.projectId, harnessId: 'claude' })
    await host.sendSessionMessage(connectionId, {
      sessionId: created.sessionId, projectPath: `remote:${connectionId}:${projectDir}`,
      providerId: 'claude', text: opened.draft.text,
    })

    // A missing grant must still be refused; only the editing composer may consume it.
    await expect(host.deleteDraft(connectionId, 'saved-draft')).rejects.toThrow(/read only/i)
    await host.deleteDraft(connectionId, 'saved-draft', opened.leaseId)
    expect(await host.listDrafts(connectionId)).toEqual([])
    // Exercise the node directly too: this must not merely hide the sidebar row.
    expect(await host.getGateway(descriptor.environmentId)!.drafts!.list()).toEqual([])
  }, 30_000)
})
