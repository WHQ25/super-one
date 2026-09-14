/**
 * A download's whole lifecycle, end to end over the delivery record
 * (`docs/design/session-sync-zone-delivery-record.md`): from the reservation a
 * `browser_download` takes, through the seal when its bytes land, to delivery —
 * eagerly by the executor inside the claim budget, or by the worker afterwards.
 *
 * The property this file exists for: one durable row per delivered file, in a
 * phase that only ever moves forward, is what protects the desktop copy from
 * the mirror and tells the worker what is left to do. There is no second copy
 * to release, no claim to hand off, no job to reconcile against — the row is
 * all three.
 *
 * Real throughout: `downloadUrl` and its streaming write, the reservation, the
 * artifact registry and its call scope, the real collecting tool surface, the
 * real `desktopHostActionExecutor`, the real `ArtifactTransferService`, and the
 * real directory mirror — over a real (in-memory) delivery record. Mocked only
 * at the boundaries Electron and the node RPC own — `session.fetch`, media
 * grants, `put`/`stat` — plus the unrelated tool subsystems the surface loads.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactPutRequest, ClaimHostActionResult } from '@superone/shared/environment'

const zone = vi.hoisted(() => ({ userData: '' }))
const wire = vi.hoisted(() => ({
  gate: { promise: Promise.resolve(), open: () => {} },
  fetched: [] as string[],
}))

vi.mock('../database', async () => (await import('../../test/fixtures/delivery-db')).deliveryDatabase())
vi.mock('electron', () => ({
  app: { getPath: () => zone.userData },
  session: {
    fromPartition: () => ({
      fetch: async (url: string) => {
        wire.fetched.push(url)
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode('FIRST'))
            await wire.gate.promise
            controller.enqueue(new TextEncoder().encode('SECOND'))
            controller.close()
          },
        })
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: (h: string) => (h === 'content-type' ? 'text/csv' : null) },
          body,
        }
      },
      on: () => {},
    }),
  },
}))
vi.mock('../logger', () => ({ default: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } }))
vi.mock('../media-file-grants', () => ({ mediaFileGrants: () => ({ add: () => {} }) }))
vi.mock('./browser-automation-bridge', () => ({ browserAutomationCall: vi.fn(async () => ({ webContentsIds: [] })) }))
vi.mock('../browser/browser-automation-bridge', () => ({ browserAutomationCall: vi.fn(async () => ({ webContentsIds: [] })) }))
vi.mock('../app-settings-service', () => ({ readAppSettings: () => ({}) }))

/** The node side: accept a push, serve a stat, and let the test break `put`. */
const node = vi.hoisted(() => ({
  putFails: false,
  puts: 0,
  files: new Map<string, Buffer>(),
  parts: new Map<string, Buffer[]>(),
  alreadyThere: false,
}))

let service: import('./artifact-transfer-service').ArtifactTransferService
const envHost = vi.hoisted(() => ({
  getSyncZone: () => ({ syncRoot: '/home/node/.superone/node/sync', os: 'linux' as const }),
  artifactPut: async (_c: unknown, req: ArtifactPutRequest) => {
    node.puts += 1
    if (node.putFails) throw new Error('node refused the chunk')
    const chunks = node.parts.get(req.transferId) ?? []
    chunks.push(Buffer.from(req.chunk, 'base64'))
    node.parts.set(req.transferId, chunks)
    const written = chunks.reduce((n, c) => n + c.length, 0)
    if (!req.final) return { ok: true as const, bytesWritten: written }
    node.files.set(req.relativePath, Buffer.concat(chunks))
    return { ok: true as const, bytesWritten: written, mtimeMs: 1_700_000_000_000 }
  },
  artifactStat: async (_c: unknown, _s: unknown, relativePath: string) => {
    if (!node.alreadyThere) return { exists: false, size: 0, mtimeMs: 0 }
    const st = statSync(join(zone.userData, 'sync', SESSION, relativePath))
    return { exists: true, size: st.size, mtimeMs: Math.floor(st.mtimeMs) }
  },
  get artifactTransfers() {
    return service
  },
}))
vi.mock('./environment-host', () => ({ getEnvironmentHost: () => envHost }))

/** `browser_download` stands in for the browser layer; the download itself is real. */
const browser = vi.hoisted(() => ({
  executeBrowserTool: vi.fn(async (_sessionId: string, _toolName: string, _args: unknown): Promise<unknown> => ({ content: [] })),
  isBrowserToolName: (name: string) => name.startsWith('browser_'),
  getBrowserToolDescriptors: () => [],
  clearBrowserToolHandlers: vi.fn(),
}))
vi.mock('../mcp/browser-mcp-tools', () => browser)
vi.mock('../computer-use/tools', () => ({
  executeComputerUseTool: vi.fn(),
  getComputerUseToolDescriptors: () => [],
  isComputerUseEnabled: () => false,
  isComputerUseToolName: () => false,
}))
vi.mock('../mcp/superone-mcp-server', () => ({
  dispatchAppToolCall: vi.fn(),
  getAppToolDefs: () => new Map(),
  getSessionHost: () => null,
  getAppSettingsApplier: () => () => {},
  notifyDevAppReady: vi.fn(),
}))
vi.mock('../mcp/superone-mcp-builtins', () => ({
  BUILT_IN_SUPERONE_TOOL_DEFS: [],
  BUILT_IN_SUPERONE_TOOL_NAMES: [],
  executeBuiltInSuperoneTool: vi.fn(),
}))

import { downloadUrl } from '../browser/browser-downloads'
import { classifyDeliveryAt, findDeliveryByPath, listSessionDeliveries } from '../db-session-deliveries'
import { resetDeliveryDatabase } from '../../test/fixtures/delivery-db'
import { _resetHoldersForTests } from './delivery-holders'
import { _resetZoneDeliveryForTests } from './zone-delivery'
import { ArtifactTransferService } from './artifact-transfer-service'
import { mirrorNodeDirectory } from './session-file-mirror'
import { desktopHostActionExecutor } from './host-action-executor'

const SESSION = 'node-s'
const DOWNLOAD = () => join(zone.userData, 'sync', SESSION, 'download', 'report.csv')
const DOWNLOAD_DIR = () => join(zone.userData, 'sync', SESSION, 'download')

function claimed(partial: Partial<ClaimHostActionResult> = {}): ClaimHostActionResult {
  return {
    actionId: 'a1',
    version: 2,
    claimToken: 'tok',
    claimExpiresAt: Date.now() + 600_000,
    toolGroup: 'browser',
    toolName: 'browser_download',
    sessionId: SESSION,
    args: {},
    replayPolicy: 'safe',
    turnId: null,
    ...partial,
  }
}

beforeEach(() => {
  resetDeliveryDatabase()
  _resetHoldersForTests()
  _resetZoneDeliveryForTests()
  service = new ArtifactTransferService({ put: (c, req) => envHost.artifactPut(c, req) })
  zone.userData = mkdtempSync(join(tmpdir(), 'claim-life-'))
  let open!: () => void
  wire.gate = { promise: new Promise<void>((resolve) => (open = resolve)), open: () => open() }
  wire.fetched.length = 0
  node.putFails = false
  node.puts = 0
  node.files.clear()
  node.parts.clear()
  node.alreadyThere = false
  browser.executeBrowserTool.mockReset()
  browser.executeBrowserTool.mockImplementation(async () => ({ content: [] }))
})
afterEach(() => {
  wire.gate.open()
  rmSync(zone.userData, { recursive: true, force: true })
})

async function finishBody(): Promise<void> {
  wire.gate.open()
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5))
}

/** A node whose `download` directory holds nothing: everything here is prunable unless the record protects it. */
function emptyNodeDir() {
  return {
    connectionId: 'conn-1',
    stat: async () => ({ exists: false, size: 0, mtimeMs: 0 }),
    get: async () => { throw new Error('nothing to get') },
    list: async () => ({ exists: true, entries: [], truncated: false }),
  }
}

/** The tool downloads the file to completion inside its own call. */
function downloadsToCompletion(): void {
  browser.executeBrowserTool.mockImplementationOnce(async (sessionId) => {
    const started = downloadUrl('https://x.test/report.csv', { sessionId, dir: DOWNLOAD_DIR() })
    await finishBody()
    const done = await started
    return { content: [{ type: 'text' as const, text: done.path }] }
  })
}

describe('a download delivered inside its own call', () => {
  it('is pushed eagerly by the executor and its delivery ends done', async () => {
    downloadsToCompletion()
    const out = await desktopHostActionExecutor(claimed(), new AbortController().signal, 'conn-1')
    expect(out.outcome).toBe('succeeded')
    expect(readFileSync(DOWNLOAD(), 'utf8')).toBe('FIRSTSECOND')
    // Pushed eagerly inside the claim budget — not deferred.
    expect(node.puts).toBeGreaterThan(0)
    expect(node.files.get('download/report.csv')?.toString()).toBe('FIRSTSECOND')
    // The delivery is over and the desktop copy is now the node's to own.
    expect(findDeliveryByPath(SESSION, DOWNLOAD())).toMatchObject({ phase: 'notifying', outcome: 'done' })
    expect(classifyDeliveryAt(SESSION, DOWNLOAD())).toBe('node-authoritative')
  })

  it('leaves an eager push whose final put failed needing re-delivery, still protected, never auto-retried (§6)', async () => {
    // This file is a single chunk, so its only put is the final one: once that
    // is sent its outcome is unknowable from here (§2), whether it was rejected
    // or its reply was lost. The delivery is left `committing`, given up so no
    // worker resends it, and still protecting the desktop copy.
    node.putFails = true
    downloadsToCompletion()
    const out = await desktopHostActionExecutor(claimed(), new AbortController().signal, 'conn-1')
    expect(out.outcome).toBe('succeeded')
    expect(node.files.has('download/report.csv')).toBe(false)
    expect(JSON.stringify(out.result)).toContain('deferred')
    const stalled = findDeliveryByPath(SESSION, DOWNLOAD())!
    expect(stalled).toMatchObject({ phase: 'committing', outcome: null, nextAttemptAt: null })
    expect(stalled.gaveUpAt).not.toBeNull()
    expect(classifyDeliveryAt(SESSION, DOWNLOAD())).toBe('protected-unreadable')

    // A directory mirror would otherwise prune it; the row protects it.
    await mirrorNodeDirectory(SESSION, 'download', emptyNodeDir())
    expect(readFileSync(DOWNLOAD(), 'utf8')).toBe('FIRSTSECOND')

    // Settings shows it as needing re-delivery, but neither an automatic pass
    // nor Retry Upload resends it: only a re-delivery under a new path can.
    expect(service.givenUp(SESSION).map((r) => r.relativePath)).toEqual(['download/report.csv'])
    expect(service.retryGivenUp(SESSION)).toEqual({ retried: 0 })
    node.putFails = false
    await service.runOnce('conn-1')
    expect(node.files.has('download/report.csv')).toBe(false)
  })
})

describe('a download still streaming when the tool returns', () => {
  it('stays writing while the body is open, then sealed for the worker once it finishes', async () => {
    let streaming: Promise<unknown> | null = null
    browser.executeBrowserTool.mockImplementationOnce(async (sessionId) => {
      streaming = downloadUrl('https://x.test/report.csv', { sessionId, dir: DOWNLOAD_DIR() })
      // Let the reservation and first chunk land, then reply without waiting.
      await new Promise((r) => setTimeout(r, 10))
      return { content: [{ type: 'text' as const, text: 'downloading in the background' }] }
    })

    const out = await desktopHostActionExecutor(claimed(), new AbortController().signal, 'conn-1')
    expect(out.outcome).toBe('succeeded')
    // Still being written: the executor pushed nothing, and the row is `writing`.
    expect(classifyDeliveryAt(SESSION, DOWNLOAD())).toBe('protected-unreadable')
    expect(existsSync(DOWNLOAD())).toBe(true)

    await finishBody()
    await streaming
    expect(readFileSync(DOWNLOAD(), 'utf8')).toBe('FIRSTSECOND')
    // Sealed by the writer, held by nobody: a complete original the worker will take.
    expect(findDeliveryByPath(SESSION, DOWNLOAD())).toMatchObject({ phase: 'sealed', holder: null, outcome: null })

    await service.runOnce('conn-1')
    expect(node.files.get('download/report.csv')?.toString()).toBe('FIRSTSECOND')
  })
})

describe('a download whose action is cancelled as it completes', () => {
  it('leaves its sealed delivery for the worker rather than orphaning the file', async () => {
    const cancel = new AbortController()
    browser.executeBrowserTool.mockImplementationOnce(async (sessionId) => {
      const started = downloadUrl('https://x.test/report.csv', { sessionId, dir: DOWNLOAD_DIR() })
      await finishBody()
      const done = await started
      // The cancel lands in the same turn the tool completes.
      cancel.abort()
      return { content: [{ type: 'text' as const, text: done.path }] }
    })

    await desktopHostActionExecutor(claimed(), cancel.signal, 'conn-1')
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5))
    // The file is complete and sealed; the row keeps it for the worker rather
    // than being abandoned mid-cancel. It survives a mirror and then delivers.
    expect(findDeliveryByPath(SESSION, DOWNLOAD())).toMatchObject({ phase: 'sealed', holder: null, outcome: null })
    await mirrorNodeDirectory(SESSION, 'download', emptyNodeDir())
    expect(existsSync(DOWNLOAD())).toBe(true)
    await service.runOnce('conn-1')
    expect(node.files.get('download/report.csv')?.toString()).toBe('FIRSTSECOND')
  })
})

describe('the same download named by two calls', () => {
  it('is one delivery: a second listing observes the row rather than opening another (R2, R3a)', async () => {
    const { registerDownload, reserveDownloadPath } = await import('../agent/browser-download-store')
    const path = reserveDownloadPath('report.csv', DOWNLOAD_DIR(), SESSION, { connectionId: 'conn-1' })
    writeFileSync(path, 'ALL-BYTES')
    registerDownload(SESSION, path, true)
    const first = findDeliveryByPath(SESSION, path)!
    expect(first).toMatchObject({ phase: 'sealed' })

    // The eager push delivers it in a listing Host Action that names it.
    node.alreadyThere = false
    browser.executeBrowserTool.mockImplementationOnce(async (sessionId) => {
      registerDownload(sessionId, path, true)
      return { content: [{ type: 'text' as const, text: path }] }
    })
    await desktopHostActionExecutor(claimed({ toolName: 'browser_list_downloads' }), new AbortController().signal, 'conn-1')
    expect(node.files.get('download/report.csv')?.toString()).toBe('ALL-BYTES')

    // A second listing re-registers the same path: it observes the same, now
    // delivered, row — never a second delivery, never a second transfer.
    node.puts = 0
    browser.executeBrowserTool.mockImplementationOnce(async (sessionId) => {
      registerDownload(sessionId, path, true)
      return { content: [{ type: 'text' as const, text: path }] }
    })
    await desktopHostActionExecutor(claimed({ toolName: 'browser_list_downloads' }), new AbortController().signal, 'conn-1')
    expect(node.puts).toBe(0)
    expect(listSessionDeliveries(SESSION)).toHaveLength(1)
    expect(findDeliveryByPath(SESSION, path)).toMatchObject({ deliveryId: first.deliveryId, outcome: 'done' })
  })
})

describe('a session deleted mid-flight', () => {
  it('delivers nothing more once its zone is dropped', async () => {
    const { registerDownload, reserveDownloadPath } = await import('../agent/browser-download-store')
    const path = reserveDownloadPath('report.csv', DOWNLOAD_DIR(), SESSION, { connectionId: 'conn-1' })
    writeFileSync(path, 'ALL-BYTES')
    registerDownload(SESSION, path, true)
    expect(findDeliveryByPath(SESSION, path)).toMatchObject({ phase: 'sealed' })

    service.dropSession(SESSION)
    // The row is abandoned and a tombstone refuses anything new; the worker
    // finds nothing to do.
    expect(findDeliveryByPath(SESSION, path)).toMatchObject({ outcome: 'abandoned' })
    await service.runOnce('conn-1')
    expect(node.files.has('download/report.csv')).toBe(false)
  })
})
