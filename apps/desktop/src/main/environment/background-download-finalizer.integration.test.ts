/**
 * A download that outlives the tool call that started it.
 *
 * This is the entry the claim/handoff tests kept standing in for: every other
 * case in `download-claim-lifecycle.integration.test.ts` calls `downloadUrl`
 * or `queueDownloadUpload` directly, so none of them exercise
 * `browser-download-tasks.ts`'s own settle — the one that decides a
 * backgrounded download needs queueing at all, notifies the agent, and does it
 * with the tool's call scope long closed.
 *
 * Real throughout: `startUrlDownloadTask` / `raceDownloadTask` and their
 * timeout, the real reservation and write claim, the real handoff instance,
 * the real `ArtifactTransferService` over a real (in-memory) job table, and the
 * real directory mirror. Mocked only at the boundaries Electron and the node
 * RPC own — `session.fetch`, media grants, `put`, `notifyCompleted`.
 */
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactPutRequest } from '@superone/shared/environment'

const zone = vi.hoisted(() => ({ userData: '' }))
const wire = vi.hoisted(() => ({
  /** Opened when the test lets the rest of the response body through. */
  gate: { promise: Promise.resolve(), open: () => {} },
}))
const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }))

vi.mock('../database', () => ({ getDb: getDbMock }))
vi.mock('../logger', () => ({ default: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } }))
vi.mock('../media-file-grants', () => ({ mediaFileGrants: () => ({ add: () => {} }) }))
vi.mock('../app-settings-service', () => ({ readAppSettings: () => ({}) }))
vi.mock('electron', () => ({
  app: { getPath: () => zone.userData },
  session: {
    fromPartition: () => ({
      fetch: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: (h: string) => (h === 'content-type' ? 'text/csv' : null) },
        body: new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode('FIRST'))
            await wire.gate.promise
            controller.enqueue(new TextEncoder().encode('SECOND'))
            controller.close()
          },
        }),
      }),
      on: () => {},
    }),
  },
}))

import { activeWriteAt, resetActiveWrites } from './active-writes'
import { ArtifactTransferService } from './artifact-transfer-service'
import { listArtifactTransfersForSession } from '../db-artifact-transfers'
import { acquireHandoff, resetPendingHandoffs } from './pending-handoffs'
import { mirrorNodeArtifact, mirrorNodeDirectory } from './session-file-mirror'
import {
  _resetDownloadTasksForTests,
  raceDownloadTask,
  setBrowserDownloadTaskHost,
  startUrlDownloadTask,
} from '../browser/browser-download-tasks'
import { collectArtifacts, takeArtifacts } from '../mcp/artifact-registry'

const SESSION = 'node-s'
const CONNECTION = 'conn-1'

let db: Database.Database
let root: string
let service: ArtifactTransferService
const nodeFiles = new Map<string, Buffer>()
/** Every transfer id the node was pushed under, so a second delivery is visible. */
const putIds: string[] = []
const notified: { relativePaths: string[] }[] = []
const injected: string[] = []

function newService(putFails = false): ArtifactTransferService {
  return new ArtifactTransferService({
    put: async (_c: string, req: ArtifactPutRequest) => {
      if (putFails) throw new Error('node refused the chunk')
      putIds.push(req.transferId)
      const previous = nodeFiles.get(req.relativePath) ?? Buffer.alloc(0)
      const whole = Buffer.concat([previous, Buffer.from(req.chunk, 'base64')])
      nodeFiles.set(req.relativePath, whole)
      return { ok: true as const, bytesWritten: whole.length, ...(req.final ? { mtimeMs: 1_700_000_000_000 } : {}) }
    },
    notifyCompleted: async (_c: string, input: { relativePaths: string[] }) => void notified.push(input),
  })
}

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE artifact_transfer_jobs (
      job_id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, session_id TEXT NOT NULL,
      local_path TEXT NOT NULL, relative_path TEXT NOT NULL, transfer_id TEXT NOT NULL,
      offset INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )
  `)
  getDbMock.mockReturnValue(db)
  root = mkdtempSync(join(tmpdir(), 'bg-finalizer-'))
  zone.userData = root
  let open!: () => void
  wire.gate = { promise: new Promise<void>((resolve) => (open = resolve)), open: () => open() }
  nodeFiles.clear()
  putIds.length = 0
  notified.length = 0
  injected.length = 0
  resetActiveWrites()
  resetPendingHandoffs()
  _resetDownloadTasksForTests()
  setBrowserDownloadTaskHost({
    emitHostEvent: () => {},
    injectTaskNotification: async (_sessionId: string, content: string) => void injected.push(content),
  })
  service = newService()
})
afterEach(() => {
  wire.gate.open()
  setBrowserDownloadTaskHost(null)
  rmSync(root, { recursive: true, force: true })
  db.close()
})

/** The download's desktop path, once the task has reserved it. */
const downloadPath = (): string => join(root, 'sync', SESSION, 'download', 'report.csv')

/** A node that serves whatever `nodeFiles` currently holds. */
function liveNodeFiles() {
  const MTIME = 1_700_000_002_000
  return {
    connectionId: CONNECTION,
    stat: async ({ relativePath }: { relativePath: string }) => {
      const file = nodeFiles.get(relativePath)
      return file ? { exists: true, size: file.length, mtimeMs: MTIME } : { exists: false, size: 0, mtimeMs: 0 }
    },
    get: async (req: { relativePath: string; offset: number; maxBytes: number }) => {
      const file = nodeFiles.get(req.relativePath)!
      const slice = file.subarray(req.offset, req.offset + req.maxBytes)
      return { chunk: slice.toString('base64'), total: file.length, mtimeMs: MTIME, eof: req.offset + slice.length >= file.length }
    },
    list: async () => ({ exists: true, entries: [], truncated: false }),
  }
}

/** A node that lists nothing: anything unprotected in that directory is prunable. */
function emptyNodeDir() {
  return {
    connectionId: CONNECTION,
    stat: async () => ({ exists: false, size: 0, mtimeMs: 0 }),
    get: async () => {
      throw new Error('nothing to get')
    },
    list: async () => ({ exists: true, entries: [], truncated: false }),
  }
}

/**
 * Run `browser_download`'s real shape: start the task inside a call scope,
 * race it against a timeout it will lose, and close the scope — which is what
 * makes the rest of the transfer nobody's, until the finalizer runs.
 */
async function backgroundedDownload(): Promise<string> {
  let taskId = ''
  await collectArtifacts(SESSION, 'call-1', async () => {
    const task = startUrlDownloadTask(SESSION, 'https://x.test/report.csv', 'report.csv', join(root, 'sync', SESSION, 'download'))
    taskId = task.taskId
    const raced = await raceDownloadTask(taskId, 20)
    expect(raced.mode).toBe('background')
  }, CONNECTION)
  takeArtifacts(SESSION, 'call-1')
  return taskId
}

async function settleBody(): Promise<void> {
  wire.gate.open()
  for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 5))
}

describe('a download that finishes after its tool call', () => {
  it('survives a mirror of its directory while the tool call is already over', async () => {
    await backgroundedDownload()
    // The scope is closed, the bytes are still arriving, and no job names it.
    expect(activeWriteAt(SESSION, downloadPath())).toBe('writing')
    const mid = await mirrorNodeDirectory(SESSION, 'download', emptyNodeDir())
    expect(mid).toMatchObject({ kind: 'unavailable' })
    expect(existsSync(downloadPath())).toBe(true)

    await settleBody()
    expect(readFileSync(downloadPath(), 'utf8')).toBe('FIRSTSECOND')
  })

  it('queues, uploads and notifies through the real job table once it settles', async () => {
    await backgroundedDownload()
    await settleBody()

    // The finalizer filed a job — nothing else could have, the scope was gone.
    const queued = listArtifactTransfersForSession(SESSION)
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ relativePath: 'download/report.csv', state: 'pending' })
    // And the agent was told the download itself finished.
    expect(injected.join('\n')).toContain('status="completed"')

    await service.runOnce(CONNECTION)
    expect(nodeFiles.get('download/report.csv')?.toString()).toBe('FIRSTSECOND')
    expect(notified).toEqual([{ sessionId: SESSION, notificationId: queued[0]!.jobId, relativePaths: ['download/report.csv'] }])
    expect(listArtifactTransfersForSession(SESSION)).toEqual([])
    // The job saw it through, so nothing is holding the path any more.
    expect(activeWriteAt(SESSION, downloadPath())).toBeNull()
  })

  it('keeps the only copy when the settle cannot reach the job table', async () => {
    getDbMock.mockImplementation(() => {
      throw new Error('SQLITE_BUSY')
    })
    await backgroundedDownload()
    await settleBody()
    expect(activeWriteAt(SESSION, downloadPath())).toBe('sealed')

    // Restored. Nothing was filed while it was down — the file was held, not
    // half-queued.
    getDbMock.mockReturnValue(db)
    expect(listArtifactTransfersForSession(SESSION)).toEqual([])

    // The connection's worker starts: the production recovery entry, the same
    // one Settings' Retry Upload uses. Only once the row exists does the file
    // stop being held.
    expect(service.retryFailedHandoffs(CONNECTION).retried).toBe(1)
    expect(listArtifactTransfersForSession(SESSION)).toHaveLength(1)
    expect(activeWriteAt(SESSION, downloadPath())).toBeNull()
  })

  it('does not redeliver when the original worker finishes before a blocked lookup recovers', async () => {
    // The file is already a queued job. A later reader arrives while the job
    // table cannot be read: it cannot tell whether a job carries this file, so
    // it holds the file and asks again later. Meanwhile the worker that owns
    // the row finishes and deletes it — and from then on `absent` means "the
    // delivery is done" just as readily as "there was never one". Inferring
    // the second mints a new transfer id and pushes the desktop's copy again,
    // over whatever the agent changed on the node in between.
    await backgroundedDownload()
    await settleBody()
    const job = listArtifactTransfersForSession(SESSION)[0]!

    getDbMock.mockImplementation(() => {
      throw new Error('SQLITE_BUSY')
    })
    const blocked = acquireHandoff({
      connectionId: CONNECTION,
      sessionId: SESSION,
      localPath: downloadPath(),
      relativePath: 'download/report.csv',
      bytes: 11,
      enqueue: (input) => service.defer(input),
    })
    expect(blocked?.mine).toBe(false)
    expect(activeWriteAt(SESSION, downloadPath())).toBe('sealed')
    getDbMock.mockReturnValue(db)

    // The worker sees the delivery through, and says so.
    await service.runOnce(CONNECTION)
    expect(nodeFiles.get('download/report.csv')?.toString()).toBe('FIRSTSECOND')
    expect(listArtifactTransfersForSession(SESSION)).toEqual([])
    expect(activeWriteAt(SESSION, downloadPath())).toBeNull()

    // The agent edits the file on the node. Nothing here is owed to it any
    // more, so this desktop is a mirror of that — not a source for it.
    nodeFiles.set('download/report.csv', Buffer.from('NEW'))

    // The ladder runs: it has nothing left to pick up and files no second job.
    expect(service.retryFailedHandoffs(CONNECTION).retried).toBe(0)
    expect(listArtifactTransfersForSession(SESSION)).toEqual([])
    await service.runOnce(CONNECTION)
    // One id, once: the file is small enough to be a single chunk.
    expect(putIds).toEqual([job.transferId])

    const read = await mirrorNodeArtifact(SESSION, 'download/report.csv', liveNodeFiles())
    expect(read).toMatchObject({ kind: 'local' })
    expect(readFileSync(downloadPath(), 'utf8')).toBe('NEW')
  })

  it('does not redeliver a file whose row owes only the completion wake', async () => {
    // The wider form of the same defect, and it needs no worker at all. A row
    // in `uploaded` is invisible to "does a job still owe these bytes?" —
    // correctly, because a NEW version of the file must not join it. But a
    // placeholder that never received an upload identity is not a new version,
    // and reading that silence as "nobody has this file" hands it a second
    // transfer id for bytes the node is already holding.
    await backgroundedDownload()
    await settleBody()
    const first = listArtifactTransfersForSession(SESSION)[0]!.transferId
    await service.runOnce(CONNECTION)
    expect(listArtifactTransfersForSession(SESSION)).toEqual([])

    // A later eager push delivered the same path and left a row owing the wake.
    service.noteDelivered({
      connectionId: CONNECTION,
      sessionId: SESSION,
      localPath: downloadPath(),
      relativePath: 'download/report.csv',
      transferId: 'pushed-1',
    })
    nodeFiles.set('download/report.csv', Buffer.from('NEW'))

    getDbMock.mockImplementation(() => {
      throw new Error('SQLITE_BUSY')
    })
    const blocked = acquireHandoff({
      connectionId: CONNECTION,
      sessionId: SESSION,
      localPath: downloadPath(),
      relativePath: 'download/report.csv',
      bytes: 11,
      enqueue: (input) => service.defer(input),
    })
    expect(blocked?.mine).toBe(false)
    getDbMock.mockReturnValue(db)

    // It asks again and is told the truth: that row has this file.
    expect(service.retryFailedHandoffs(CONNECTION).retried).toBe(1)
    expect(listArtifactTransfersForSession(SESSION).map((j) => j.transferId)).toEqual(['pushed-1'])
    await service.runOnce(CONNECTION)
    // Only the download's own upload ever happened; the agent's edit stands.
    expect(putIds).toEqual([first])
    expect(nodeFiles.get('download/report.csv')?.toString()).toBe('NEW')
  })

  it('files nothing for a session deleted before the download settles', async () => {
    await backgroundedDownload()
    service.dropSession(SESSION)
    await settleBody()
    expect(listArtifactTransfersForSession(SESSION)).toEqual([])
    expect(activeWriteAt(SESSION, downloadPath())).toBeNull()
  })
})
