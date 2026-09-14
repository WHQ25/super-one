/**
 * Who ends a write claim, across the four ways a download can finish.
 *
 * The claim registry (`active-writes.ts`) is only as good as the handoffs
 * around it, and those are spread over the download task, the Host Action
 * executor and the transfer queue. "A claim is released exactly once, by
 * whoever actually took responsibility for the file" is the property; this is
 * where it is asserted end to end rather than argued.
 *
 * Real throughout: `downloadUrl` and its streaming write, the reservation, the
 * artifact registry and its call scope, the real collecting tool surface, and
 * the real `desktopHostActionExecutor`. Mocked only at the boundaries Electron
 * and the database own — `session.fetch`, media grants, the node RPCs — plus
 * the unrelated tool subsystems the surface would otherwise load.
 */
import { readFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaimHostActionResult } from '@superone/shared/environment'

const zone = vi.hoisted(() => ({ userData: '' }))
const wire = vi.hoisted(() => ({
  /**
   * Opened when the test lets the rest of the body through. Created up front,
   * not inside the stream: a test that opens the gate before the stream has
   * started must still be heard, or the body waits for ever.
   */
  gate: { promise: Promise.resolve(), open: () => {} },
  fetched: [] as string[],
}))

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
vi.mock('../media-file-grants', () => ({ mediaFileGrants: () => ({ add: () => {} }) }))
vi.mock('./browser-automation-bridge', () => ({ browserAutomationCall: vi.fn(async () => ({ webContentsIds: [] })) }))
vi.mock('../browser/browser-automation-bridge', () => ({ browserAutomationCall: vi.fn(async () => ({ webContentsIds: [] })) }))
vi.mock('../app-settings-service', () => ({ readAppSettings: () => ({}) }))

/** The node side: enough to accept a push, and a `defer` the test can break. */
const node = vi.hoisted(() => ({
  deferred: [] as string[],
  deferFails: false,
  files: new Map<string, Buffer>(),
}))
const envHost = vi.hoisted(() => ({
  getSyncZone: () => ({ syncRoot: '/home/node/.superone/node/sync', os: 'linux' as const }),
  artifactPut: async () => ({ ok: true as const, bytesWritten: 0, mtimeMs: 1_700_000_000_000 }),
  artifactStat: async () => ({ exists: false, size: 0, mtimeMs: 0 }),
  artifactTransfers: {
    throughputBytesPerMs: () => 1024,
    recordThroughput: () => {},
    defer: async (input: { relativePath: string }) => {
      if (node.deferFails) throw new Error('SQLITE_BUSY')
      node.deferred.push(input.relativePath)
    },
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
import { activeWriteAt, resetActiveWrites } from './active-writes'
import { desktopHostActionExecutor } from './host-action-executor'

const SESSION = 'node-s'
const DOWNLOAD = () => join(zone.userData, 'sync', SESSION, 'download', 'report.csv')

function claimed(partial: Partial<ClaimHostActionResult> = {}): ClaimHostActionResult {
  return {
    actionId: 'a1',
    version: 2,
    claimToken: 'tok',
    claimExpiresAt: Date.now() + 5_000,
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
  zone.userData = mkdtempSync(join(tmpdir(), 'claim-life-'))
  let open!: () => void
  wire.gate = { promise: new Promise<void>((resolve) => (open = resolve)), open: () => open() }
  wire.fetched.length = 0
  node.deferred.length = 0
  node.deferFails = false
  node.files.clear()
  resetActiveWrites()
})
afterEach(() => {
  wire.gate.open()
  rmSync(zone.userData, { recursive: true, force: true })
})

/** Let the gated response body finish, and give the stream a turn to drain. */
async function finishBody(): Promise<void> {
  wire.gate.open()
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5))
}

describe('who ends a download write claim', () => {
  it('releases it once, through the executor, when the download finishes inside the call', async () => {
    browser.executeBrowserTool.mockImplementationOnce(async (sessionId) => {
      // Real reservation, real streaming write, real seal.
      const started = downloadUrl('https://x.test/report.csv', { sessionId, dir: join(zone.userData, 'sync', SESSION, 'download') })
      await finishBody()
      const done = await started
      return { content: [{ type: 'text' as const, text: done.path }] }
    })

    const out = await desktopHostActionExecutor(claimed(), new AbortController().signal, 'conn-1')
    expect(out.outcome).toBe('succeeded')
    expect(readFileSync(DOWNLOAD(), 'utf8')).toBe('FIRSTSECOND')
    // The push adopted the sealed file and ended the claim: nothing is pinned.
    expect(activeWriteAt(SESSION, DOWNLOAD())).toBeNull()
  })

  it('leaves a still-streaming download protected when the tool returns without it', async () => {
    // What "the tool went background on its deadline" looks like from here: the
    // reply is sent, the ref for the reservation rides along with it, and the
    // transfer is still running. Releasing on that ref is the AB1 defect.
    let streaming: Promise<unknown> | null = null
    browser.executeBrowserTool.mockImplementationOnce(async (sessionId) => {
      streaming = downloadUrl('https://x.test/report.csv', { sessionId, dir: join(zone.userData, 'sync', SESSION, 'download') })
      // Let the reservation and the first chunk land, then reply without waiting.
      await new Promise((r) => setTimeout(r, 10))
      return { content: [{ type: 'text' as const, text: 'downloading in the background' }] }
    })

    const out = await desktopHostActionExecutor(claimed(), new AbortController().signal, 'conn-1')
    expect(out.outcome).toBe('succeeded')
    // Still being written, and still the writer's: the executor took nothing.
    expect(activeWriteAt(SESSION, DOWNLOAD())).toBe('writing')

    await finishBody()
    await streaming
    expect(readFileSync(DOWNLOAD(), 'utf8')).toBe('FIRSTSECOND')
    // Sealed by the writer, and nobody adopted it — the eager push is long gone,
    // so the file stays protected rather than becoming prunable behind its back.
    expect(activeWriteAt(SESSION, DOWNLOAD())).toBe('sealed')
  })

  it('does not leave a sealed claim behind when the action is cancelled as the tool completes', async () => {
    const cancel = new AbortController()
    browser.executeBrowserTool.mockImplementationOnce(async (sessionId) => {
      const started = downloadUrl('https://x.test/report.csv', { sessionId, dir: join(zone.userData, 'sync', SESSION, 'download') })
      await finishBody()
      const done = await started
      // The cancel lands in the same turn the tool completes — the window where
      // the executor used to return early, before its release region.
      cancel.abort()
      return { content: [{ type: 'text' as const, text: done.path }] }
    })

    await desktopHostActionExecutor(claimed(), cancel.signal, 'conn-1')
    // The executor answers from its abort race, so the tool's own work settles
    // a turn later; the claim is asserted after that drains, not before.
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5))
    // Nothing downstream will ever push this file, so holding the claim would
    // pin the path for the life of the process.
    expect(activeWriteAt(SESSION, DOWNLOAD())).toBeNull()
  })

  it('keeps a completed file protected when the transfer queue will not take it', async () => {
    // The bytes are all here and the node has none of them. A failed `defer`
    // is not a handoff: releasing would make the only complete copy prunable.
    node.deferFails = true
    const { queueDownloadUpload } = await import('../agent/browser-download-store')
    const { registerDownload, reserveDownloadPath } = await import('../agent/browser-download-store')
    const path = reserveDownloadPath('report.csv', join(zone.userData, 'sync', SESSION, 'download'), SESSION, { connectionId: 'conn-1' })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path, 'ALL-BYTES')
    registerDownload(SESSION, path, true)
    expect(activeWriteAt(SESSION, path)).toBe('sealed')

    queueDownloadUpload('conn-1', SESSION, path)
    for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 10))
    expect(node.deferred).toEqual([])
    expect(activeWriteAt(SESSION, path)).toBe('sealed')
  })
})
