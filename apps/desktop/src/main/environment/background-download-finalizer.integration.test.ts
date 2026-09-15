/**
 * A download that outlives the tool call that started it.
 *
 * This is the entry the download tests kept standing in for: `downloadUrl`
 * alone never exercises `browser-download-tasks.ts`'s own settle — the one that
 * decides a backgrounded download is finished, seals its delivery record, wakes
 * the worker, and notifies the agent, all with the tool's call scope long
 * closed.
 *
 * Real throughout: `startUrlDownloadTask` / `raceDownloadTask` and their
 * timeout, the real reservation and seal, the real delivery record over a real
 * (in-memory) SQLite, the real `ArtifactTransferService`, and the real
 * directory mirror. Mocked only at the boundaries Electron and the node RPC
 * own — `session.fetch`, media grants, `put`, `notifyCompleted`.
 */
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
const hostRef = vi.hoisted(() => ({ wake: (_c: string) => {} }))

vi.mock('../database', async () => (await import('../../test/fixtures/delivery-db')).deliveryDatabase())
vi.mock('../logger', () => ({ default: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } }))
vi.mock('../media-file-grants', () => ({ mediaFileGrants: () => ({ add: () => {} }) }))
vi.mock('../app-settings-service', () => ({ readAppSettings: () => ({}) }))
// The finalizer wakes the worker through the environment host; here that is the
// test's own service.
vi.mock('./environment-host', () => ({ getEnvironmentHost: () => ({ artifactTransfers: { wake: (c: string) => hostRef.wake(c) } }) }))
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

import { resetDeliveryDatabase } from '../../test/fixtures/delivery-db'
import { classifyDeliveryAt, findDeliveryByPath, listSessionDeliveries } from '../db-session-deliveries'
import { _resetHoldersForTests } from './delivery-holders'
import { ArtifactTransferService } from './artifact-transfer-service'
import { _resetZoneDeliveryForTests } from './zone-delivery'
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

let root: string
let service: ArtifactTransferService
const nodeFiles = new Map<string, Buffer>()
/** Every transfer id the node was pushed under, so a second delivery would be visible. */
const putIds: string[] = []
const notified: { relativePaths: string[] }[] = []
const injected: string[] = []

function newService(): ArtifactTransferService {
  return new ArtifactTransferService({
    put: async (_c: string, req: ArtifactPutRequest) => {
      putIds.push(req.transferId)
      const previous = req.offset === 0 ? Buffer.alloc(0) : nodeFiles.get(req.relativePath) ?? Buffer.alloc(0)
      const whole = Buffer.concat([previous, Buffer.from(req.chunk, 'base64')])
      nodeFiles.set(req.relativePath, whole)
      return { ok: true as const, bytesWritten: whole.length, ...(req.final ? { mtimeMs: 1_700_000_000_000 } : {}) }
    },
    notifyCompleted: async (_c: string, input: { relativePaths: string[] }) => void notified.push(input),
  })
}

beforeEach(() => {
  resetDeliveryDatabase()
  _resetHoldersForTests()
  _resetZoneDeliveryForTests()
  root = mkdtempSync(join(tmpdir(), 'bg-finalizer-'))
  zone.userData = root
  let open!: () => void
  wire.gate = { promise: new Promise<void>((resolve) => (open = resolve)), open: () => open() }
  nodeFiles.clear()
  putIds.length = 0
  notified.length = 0
  injected.length = 0
  service = newService()
  hostRef.wake = () => {}
  _resetDownloadTasksForTests()
  setBrowserDownloadTaskHost({
    emitHostEvent: () => {},
    injectTaskNotification: async (_sessionId: string, content: string) => void injected.push(content),
  })
})
afterEach(() => {
  wire.gate.open()
  setBrowserDownloadTaskHost(null)
  rmSync(root, { recursive: true, force: true })
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
    // The scope is closed, the bytes are still arriving, and the row is `writing`.
    expect(classifyDeliveryAt(SESSION, downloadPath())).toBe('protected-unreadable')
    const mid = await mirrorNodeDirectory(SESSION, 'download', emptyNodeDir())
    expect(mid).toMatchObject({ kind: 'unavailable' })
    expect(existsSync(downloadPath())).toBe(true)

    await settleBody()
    expect(readFileSync(downloadPath(), 'utf8')).toBe('FIRSTSECOND')
  })

  it('seals its delivery, wakes the worker, and the worker uploads and notifies once it settles', async () => {
    const wakes: string[] = []
    hostRef.wake = (c) => wakes.push(c)
    await backgroundedDownload()
    await settleBody()

    // The finalizer sealed the delivery — nothing else could have, the scope
    // was gone — and woke the connection's worker.
    const sealed = listSessionDeliveries(SESSION)
    expect(sealed).toHaveLength(1)
    expect(sealed[0]).toMatchObject({ relativePath: 'download/report.csv', phase: 'sealed', outcome: null })
    expect(wakes).toEqual([CONNECTION])
    // And the agent was told the download itself finished.
    expect(injected.join('\n')).toContain('status="completed"')

    await service.runOnce(CONNECTION)
    expect(nodeFiles.get('download/report.csv')?.toString()).toBe('FIRSTSECOND')
    expect(notified).toEqual([{ sessionId: SESSION, notificationId: sealed[0]!.deliveryId, relativePaths: ['download/report.csv'] }])
    // Delivered: done, and nothing protects the path any more.
    expect(findDeliveryByPath(SESSION, downloadPath())).toMatchObject({ outcome: 'done' })
    expect(classifyDeliveryAt(SESSION, downloadPath())).toBe('node-authoritative')
  })

  it('does not deliver a second time after the agent edits the file on the node', async () => {
    // One path, one delivery (R2). Once it is done the desktop copy is a mirror
    // of the node's, not a source for it: a second settle or listing observes
    // the same row (R3a) and never mints a second transfer to push stale bytes
    // over what the agent changed.
    await backgroundedDownload()
    await settleBody()
    const first = findDeliveryByPath(SESSION, downloadPath())!
    await service.runOnce(CONNECTION)
    expect(putIds).toEqual([first.transferId])
    expect(findDeliveryByPath(SESSION, downloadPath())).toMatchObject({ outcome: 'done' })

    // The agent edits the file on the node.
    nodeFiles.set('download/report.csv', Buffer.from('NEW'))

    // Another worker pass has nothing to pick up; the row is done.
    await service.runOnce(CONNECTION)
    expect(putIds).toEqual([first.transferId])

    // The desktop now mirrors the node's version rather than serving its own.
    const read = await mirrorNodeArtifact(SESSION, 'download/report.csv', liveNodeFiles())
    expect(read).toMatchObject({ kind: 'local' })
    expect(readFileSync(downloadPath(), 'utf8')).toBe('NEW')
  })

  it('files nothing for a session deleted before the download settles', async () => {
    await backgroundedDownload()
    service.dropSession(SESSION)
    await settleBody()
    // The seal onto a dropped session is refused; the download is not delivered.
    expect(listSessionDeliveries(SESSION).some((r) => r.outcome === null)).toBe(false)
  })
})
