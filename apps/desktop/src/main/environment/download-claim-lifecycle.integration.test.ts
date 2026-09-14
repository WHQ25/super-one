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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
vi.mock('../logger', () => ({ default: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } }))
vi.mock('../media-file-grants', () => ({ mediaFileGrants: () => ({ add: () => {} }) }))
vi.mock('./browser-automation-bridge', () => ({ browserAutomationCall: vi.fn(async () => ({ webContentsIds: [] })) }))
vi.mock('../browser/browser-automation-bridge', () => ({ browserAutomationCall: vi.fn(async () => ({ webContentsIds: [] })) }))
vi.mock('../app-settings-service', () => ({ readAppSettings: () => ({}) }))

/** The node side: enough to accept a push, and a `defer` the test can break. */
const node = vi.hoisted(() => ({
  deferred: [] as string[],
  deferFails: false,
  putFails: false,
  puts: 0,
  files: new Map<string, Buffer>(),
  parts: new Map<string, Buffer[]>(),
  seenTransferIds: [] as string[],
  onStat: null as null | ((rel: string) => void | Promise<void>),
  statCalls: 0,
  uploadedIds: new Set<string>(),
}))
const envHost = vi.hoisted(() => ({
  getSyncZone: () => ({ syncRoot: '/home/node/.superone/node/sync', os: 'linux' as const }),
  artifactPut: async (_c: unknown, req: { transferId: string; chunk: string; final?: boolean }) => {
    node.puts += 1
    node.uploadedIds.add(req.transferId)
    if (node.putFails) throw new Error('node refused the chunk')
    // Accumulate for real: `bytesWritten` is how the uploader advances its
    // offset, so a stub that always answers 0 never terminates.
    const chunks = node.parts.get(req.transferId) ?? []
    chunks.push(Buffer.from(req.chunk, 'base64'))
    node.parts.set(req.transferId, chunks)
    const written = chunks.reduce((n, c) => n + c.length, 0)
    if (!req.final) return { ok: true as const, bytesWritten: written }
    node.files.set(req.transferId, Buffer.concat(chunks))
    return { ok: true as const, bytesWritten: written, mtimeMs: 1_700_000_000_000 }
  },
  artifactStat: async (_c: unknown, _s: unknown, relativePath: string) => {
    node.statCalls += 1
    await node.onStat?.(relativePath)
    return { exists: false, size: 0, mtimeMs: 0 }
  },
  artifactTransfers: {
    throughputBytesPerMs: () => 1024,
    recordThroughput: () => {},
    // Synchronous, like the production `defer` (statSync + SQLite insert +
    // worker wake). An async stand-in would let a throw land a turn late and
    // miss the very ordering these tests are about.
    defer: (input: { relativePath: string; transferId: string }) => {
      if (node.deferFails) throw new Error('SQLITE_BUSY')
      node.deferred.push(input.relativePath)
      node.seenTransferIds.push(input.transferId)
      return { jobId: 'j1' }
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
import { activeWriteAt, releaseWriteClaim, resetActiveWrites, takeSealedClaim } from './active-writes'
import { acquireHandoff, dropSessionHandoffs, failedHandoffs, resetPendingHandoffs, retryFailedHandoffs } from './pending-handoffs'
import { mirrorNodeDirectory } from './session-file-mirror'
import { desktopHostActionExecutor } from './host-action-executor'

const SESSION = 'node-s'
const DOWNLOAD = () => join(zone.userData, 'sync', SESSION, 'download', 'report.csv')

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
  zone.userData = mkdtempSync(join(tmpdir(), 'claim-life-'))
  let open!: () => void
  wire.gate = { promise: new Promise<void>((resolve) => (open = resolve)), open: () => open() }
  wire.fetched.length = 0
  node.deferred.length = 0
  node.deferFails = false
  node.putFails = false
  node.puts = 0
  node.files.clear()
  node.parts.clear()
  node.seenTransferIds.length = 0
  node.onStat = null
  node.statCalls = 0
  node.uploadedIds.clear()
  resetActiveWrites()
  resetPendingHandoffs()
  // A `mockImplementationOnce` an earlier test never consumed would be handed
  // to the next test's first tool call instead of its own.
  browser.executeBrowserTool.mockReset()
  browser.executeBrowserTool.mockImplementation(async () => ({ content: [] }))
})
afterEach(() => {
  vi.useRealTimers()
  wire.gate.open()
  rmSync(zone.userData, { recursive: true, force: true })
})

/** Let the gated response body finish, and give the stream a turn to drain. */
async function finishBody(): Promise<void> {
  wire.gate.open()
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5))
}

/** A node whose `download` directory holds nothing: everything here is prunable unless protected. */
function emptyNodeDir() {
  return {
    connectionId: 'conn-1',
    stat: async () => ({ exists: false, size: 0, mtimeMs: 0 }),
    get: async () => {
      throw new Error('nothing to get')
    },
    list: async () => ({ exists: true, entries: [], truncated: false }),
  }
}

/**
 * Poll on real timers. `vi.waitFor` shares the timer mocking other cases in
 * this file switch on, and silently times out here even once the condition
 * holds.
 */
async function until(ready: () => boolean, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('condition never held')
    await new Promise((r) => setTimeout(r, 5))
  }
}

/** A sealed zone file both actions will name in their replies. */
function sharedArtifact(name: string, body: string): string {
  const path = join(zone.userData, 'sync', SESSION, 'download', name)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, body)
  return path
}

/** What a `browser_list_downloads` Host Action does: name the file and register it. */
function registerSharedArtifact(path: string): void {
  browser.executeBrowserTool.mockImplementationOnce(async (sessionId) => {
    const { registerArtifact } = await import('../mcp/artifact-registry')
    registerArtifact(sessionId, { path, producer: 'download', final: true })
    return { content: [{ type: 'text' as const, text: path }] }
  })
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
    // Pushed eagerly inside the claim budget — not deferred. The distinction
    // matters: only one of those two paths ends with the node holding the file.
    expect(node.puts).toBeGreaterThan(0)
    expect(node.deferred).toEqual([])
    // The push adopted the sealed file and ended the claim: nothing is pinned.
    expect(activeWriteAt(SESSION, DOWNLOAD())).toBeNull()
    expect(failedHandoffs()).toEqual([])
  })

  it('keeps the only copy when the foreground handoff cannot be written to the job table', async () => {
    // The eager push is skipped (no budget) or fails, so the file is meant to
    // become a job — and the enqueue itself throws. Releasing here is AC1: the
    // file would have no node copy, no job row and no protection at once.
    node.putFails = true
    node.deferFails = true
    browser.executeBrowserTool.mockImplementationOnce(async (sessionId) => {
      const started = downloadUrl('https://x.test/report.csv', { sessionId, dir: join(zone.userData, 'sync', SESSION, 'download') })
      await finishBody()
      const done = await started
      return { content: [{ type: 'text' as const, text: done.path }] }
    })

    await desktopHostActionExecutor(claimed(), new AbortController().signal, 'conn-1')
    expect(node.puts).toBeGreaterThan(0)
    expect(node.deferred).toEqual([])
    // Still protected, still owned by the push that failed to hand it on.
    expect(activeWriteAt(SESSION, DOWNLOAD())).toBe('sealed')
    expect(failedHandoffs(SESSION)).toMatchObject([{ relativePath: 'download/report.csv', holdsClaim: true, lastError: expect.stringContaining('SQLITE_BUSY') }])

    // And it survives a directory mirror that would otherwise prune it.
    await mirrorNodeDirectory(SESSION, 'download', emptyNodeDir())
    expect(readFileSync(DOWNLOAD(), 'utf8')).toBe('FIRSTSECOND')
  })

  it('recovers a failed foreground handoff when the transfer service tries again', async () => {
    node.putFails = true
    node.deferFails = true
    browser.executeBrowserTool.mockImplementationOnce(async (sessionId) => {
      const started = downloadUrl('https://x.test/report.csv', { sessionId, dir: join(zone.userData, 'sync', SESSION, 'download') })
      await finishBody()
      return { content: [{ type: 'text' as const, text: (await started).path }] }
    })
    await desktopHostActionExecutor(claimed(), new AbortController().signal, 'conn-1')
    const [stuck] = failedHandoffs(SESSION)
    expect(stuck).toBeDefined()

    // Whatever was wrong is fixed; the retry files the row and only then lets go.
    node.deferFails = false
    expect(retryFailedHandoffs('conn-1')).toEqual({ retried: 1 })
    await until(() => node.deferred.length === 1)
    expect(activeWriteAt(SESSION, DOWNLOAD())).toBeNull()
    expect(failedHandoffs()).toEqual([])
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

  it('protects a producer that never reserved a path at all when its enqueue fails', async () => {
    // AD1. Only downloads reserve a path, so only downloads have a claim to
    // adopt. A screenshot is simply written and registered — recording a
    // failure for one used to note its `holder` and protect nothing, and the
    // next directory mirror deleted it.
    node.deferFails = true
    node.putFails = true
    const { writeFileSync, mkdirSync } = await import('node:fs')
    const shot = join(zone.userData, 'sync', SESSION, 'browser', 'shot.png')
    browser.executeBrowserTool.mockImplementationOnce(async (sessionId) => {
      mkdirSync(join(shot, '..'), { recursive: true })
      writeFileSync(shot, 'png-bytes')
      const { registerArtifact } = await import('../mcp/artifact-registry')
      registerArtifact(sessionId, { path: shot, producer: 'browser', final: true })
      return { content: [{ type: 'text' as const, text: shot }] }
    })

    await desktopHostActionExecutor(claimed({ toolName: 'browser_screenshot' }), new AbortController().signal, 'conn-1')
    // A claim now exists that never existed before: the task made one.
    expect(activeWriteAt(SESSION, shot)).toBe('sealed')
    expect(failedHandoffs(SESSION)).toMatchObject([{ relativePath: 'browser/shot.png', holdsClaim: true }])

    await mirrorNodeDirectory(SESSION, 'browser', emptyNodeDir())
    expect(readFileSync(shot, 'utf8')).toBe('png-bytes')
  })

  it('protects a screenshot before the first node RPC, not after the push gives up', async () => {
    // AE1. The window is the `stat` that asks whether the node already has the
    // file: it is an await, and a directory mirror landing inside it used to
    // find a screenshot nothing was holding yet. Protection after the enqueue
    // fails is far too late — by then the file is gone.
    const shot = join(zone.userData, 'sync', SESSION, 'browser', 'shot.png')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    browser.executeBrowserTool.mockImplementationOnce(async (sessionId) => {
      mkdirSync(join(shot, '..'), { recursive: true })
      writeFileSync(shot, 'png-bytes')
      const { registerArtifact } = await import('../mcp/artifact-registry')
      registerArtifact(sessionId, { path: shot, producer: 'browser', final: true })
      return { content: [{ type: 'text' as const, text: shot }] }
    })
    // The mirror runs while that first stat is outstanding.
    let mirrored: Promise<unknown> | null = null
    node.onStat = () => {
      mirrored ??= mirrorNodeDirectory(SESSION, 'browser', emptyNodeDir())
    }

    await desktopHostActionExecutor(claimed({ toolName: 'browser_screenshot' }), new AbortController().signal, 'conn-1')
    await mirrored
    expect(readFileSync(shot, 'utf8')).toBe('png-bytes')
  })

  it('joins an existing handoff instead of pushing beside it', async () => {
    // AE2. A file with a stuck handoff is delivered by a route the task cannot
    // see: the task never settles, keeps its claim — so the mirror serves this
    // desktop's copy of a file the agent later changed on the node — and its
    // ladder eventually files a redundant job that uploads the old bytes back
    // over the new ones.
    node.deferFails = true
    const { registerDownload, reserveDownloadPath, queueDownloadUpload } = await import('../agent/browser-download-store')
    const path = reserveDownloadPath('report.csv', join(zone.userData, 'sync', SESSION, 'download'), SESSION, { connectionId: 'conn-1' })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path, 'OLD')
    registerDownload(SESSION, path, true)
    queueDownloadUpload('conn-1', SESSION, path)
    await until(() => failedHandoffs(SESSION).length === 1)

    // The agent lists its downloads: a Host Action that re-registers the same
    // path and would otherwise eager-push it.
    node.puts = 0
    browser.executeBrowserTool.mockImplementationOnce(async (sessionId) => {
      registerDownload(sessionId, path, true)
      return { content: [{ type: 'text' as const, text: path }] }
    })
    const out = await desktopHostActionExecutor(claimed({ toolName: 'browser_list_downloads' }), new AbortController().signal, 'conn-1')
    expect(out.outcome).toBe('succeeded')
    // Not pushed: the task owns delivery, and the reply says so.
    expect(node.puts).toBe(0)
    expect(JSON.stringify(out.result)).toContain('deferred')
    // Still exactly one task, still holding, still the same id.
    expect(failedHandoffs(SESSION)).toHaveLength(1)
    expect(activeWriteAt(SESSION, path)).toBe('sealed')
  })

  it('keeps one task per path, so a re-registration cannot mint a second transfer id', async () => {
    // AD2. A second listing re-registers the same download; the task in flight
    // keeps its id and its claim rather than being overwritten by a guess.
    vi.useFakeTimers()
    node.deferFails = true
    const { registerDownload, reserveDownloadPath, queueDownloadUpload } = await import('../agent/browser-download-store')
    const path = reserveDownloadPath('report.csv', join(zone.userData, 'sync', SESSION, 'download'), SESSION, { connectionId: 'conn-1' })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path, 'ALL-BYTES')
    registerDownload(SESSION, path, true)
    queueDownloadUpload('conn-1', SESSION, path)
    await vi.advanceTimersByTimeAsync(10_000)
    const first = failedHandoffs(SESSION)[0]!

    // The agent lists downloads again: same file, same task.
    registerDownload(SESSION, path, true)
    queueDownloadUpload('conn-1', SESSION, path)
    await vi.advanceTimersByTimeAsync(10_000)
    const after = failedHandoffs(SESSION)
    expect(after).toHaveLength(1)
    expect(after[0]!.transferId).toBe(first.transferId)
    expect(activeWriteAt(SESSION, path)).toBe('sealed')

    // And the retry that finally works releases the claim, so the node's own
    // later version of the file is not shadowed by a stuck desktop original.
    node.deferFails = false
    retryFailedHandoffs()
    await vi.advanceTimersByTimeAsync(50)
    expect(activeWriteAt(SESSION, path)).toBeNull()
    expect(failedHandoffs(SESSION)).toEqual([])
  })

  it('has a second action defer the file while the first action\'s stat is outstanding', async () => {
    // AF1. Checking "does anyone own this?" before an await and acting on the
    // answer after it is not a check at all: B slipped in during A's stat and
    // both delivered, under two different transfer ids, so the later upload put
    // stale bytes back over the node's newer file. No receipt dedup can catch
    // two ids — the instance has to be taken before the first await.
    const shared = sharedArtifact('report.csv', 'OLD')
    let open!: () => void
    const parked = new Promise<void>((resolve) => (open = resolve))
    node.onStat = async () => {
      node.onStat = null
      await parked
    }

    registerSharedArtifact(shared)
    const a = desktopHostActionExecutor(claimed({ toolName: 'browser_list_downloads' }), new AbortController().signal, 'conn-1')
    await until(() => node.statCalls === 1)

    // B runs entirely inside A's stat.
    registerSharedArtifact(shared)
    const b = await desktopHostActionExecutor(claimed({ toolName: 'browser_list_downloads' }), new AbortController().signal, 'conn-1')
    expect(JSON.stringify(b.result)).toContain('deferred')

    open()
    await a
    // Exactly one delivery, under exactly one id.
    expect(node.seenTransferIds.length + node.uploadedIds.size).toBeLessThanOrEqual(1)
    expect(node.uploadedIds.size).toBe(1)
  })

  it('does not release one action\'s file when a concurrent action is cancelled', async () => {
    // AF2. Both callers labelled themselves `push`, so B's cleanup satisfied
    // the check on A's claim and freed a file A was still delivering — the next
    // directory mirror then deleted it out from under A.
    const shared = sharedArtifact('report.csv', 'OLD')
    let open!: () => void
    const parked = new Promise<void>((resolve) => (open = resolve))
    node.onStat = async () => {
      node.onStat = null
      await parked
    }

    registerSharedArtifact(shared)
    const a = desktopHostActionExecutor(claimed({ toolName: 'browser_list_downloads' }), new AbortController().signal, 'conn-1')
    await until(() => node.statCalls === 1)

    const cancelB = new AbortController()
    registerSharedArtifact(shared)
    cancelB.abort()
    await desktopHostActionExecutor(claimed({ toolName: 'browser_list_downloads' }), cancelB.signal, 'conn-1')
    // B touched nothing of A's: the file is still held, and still here.
    expect(activeWriteAt(SESSION, shared)).toBe('sealed')
    await mirrorNodeDirectory(SESSION, 'download', emptyNodeDir())
    expect(readFileSync(shared, 'utf8')).toBe('OLD')

    open()
    await a
    expect(activeWriteAt(SESSION, shared)).toBeNull()
  })

  it('will not let one holder release another holder\'s claim', async () => {
    // AF2's primitive. The single-instance rule above is what makes two owners
    // unreachable in practice, but it rests on the claim being unable to
    // confuse them: a role label (`push`) was satisfied by whichever caller
    // wore it, so cancelling one action freed the file another was delivering.
    const path = sharedArtifact('report.csv', 'OLD')
    expect(takeSealedClaim(SESSION, path, 'token-a')).toBe(true)
    // A second holder cannot take a file that is already spoken for...
    expect(takeSealedClaim(SESSION, path, 'token-b')).toBe(false)
    // ...and cannot release it either.
    expect(releaseWriteClaim(SESSION, path, 'token-b')).toBe(false)
    expect(activeWriteAt(SESSION, path)).toBe('sealed')
    // Only the holder that took it can end it.
    expect(releaseWriteClaim(SESSION, path, 'token-a')).toBe(true)
    expect(activeWriteAt(SESSION, path)).toBeNull()
  })

  it('keeps a completed file protected when the transfer queue will not take it', async () => {
    vi.useFakeTimers()
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
    // Past every one of [100, 500, 2000, 5000]ms, so this is the FINAL give-up
    // and not merely "still retrying".
    await vi.advanceTimersByTimeAsync(10_000)
    expect(node.deferred).toEqual([])
    expect(activeWriteAt(SESSION, path)).toBe('sealed')
    expect(failedHandoffs(SESSION)).toMatchObject([{ holdsClaim: true, relativePath: 'download/report.csv' }])

    // Recovery uses the SAME transfer id, so the node resumes its partial
    // upload instead of meeting a second transfer for one file.
    const first = failedHandoffs(SESSION)[0]!
    node.deferFails = false
    node.seenTransferIds.length = 0
    expect(retryFailedHandoffs()).toEqual({ retried: 1 })
    await vi.advanceTimersByTimeAsync(50)
    // Same id: the node resumes its partial upload instead of meeting a second
    // transfer for one file.
    expect(node.seenTransferIds).toEqual([first.transferId])
    expect(activeWriteAt(SESSION, path)).toBeNull()
  })

  it('does not let a retry in flight re-register a session that was deleted mid-ladder', async () => {
    // AD3. The delete lands after the first enqueue failed but long before the
    // ladder runs out, so there is nothing in the table for `dropSession` to
    // find — and the entry used to appear afterwards, holding a claim on a
    // file that no longer exists.
    vi.useFakeTimers()
    node.deferFails = true
    const { registerDownload, reserveDownloadPath, queueDownloadUpload } = await import('../agent/browser-download-store')
    const path = reserveDownloadPath('report.csv', join(zone.userData, 'sync', SESSION, 'download'), SESSION, { connectionId: 'conn-1' })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path, 'ALL-BYTES')
    registerDownload(SESSION, path, true)
    queueDownloadUpload('conn-1', SESSION, path)
    await vi.advanceTimersByTimeAsync(20)

    dropSessionHandoffs(SESSION)
    expect(failedHandoffs(SESSION)).toEqual([])
    expect(activeWriteAt(SESSION, path)).toBeNull()

    // Whatever was wrong clears up while the ladder is still running. Nothing
    // should reach the job table for a session that no longer exists.
    node.deferFails = false
    await vi.advanceTimersByTimeAsync(10_000)
    expect(node.deferred).toEqual([])
    expect(failedHandoffs(SESSION)).toEqual([])
  })

  it('does not file a job for a session deleted while its enqueue was in flight', async () => {
    // The narrow window the generation check exists for: cancelling the retry
    // timer cannot help an attempt that is already awaiting. When it resolves
    // it would file a row, and release a claim, for a session that is gone.
    const filed: string[] = []
    const path = join(zone.userData, 'sync', SESSION, 'browser', 'shot.png')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, 'png-bytes')

    // The caller resolved a dependency first — `queueDownloadUpload` waits for
    // the environment host — and the session was deleted while it waited.
    dropSessionHandoffs(SESSION)
    const acquired = acquireHandoff({
      connectionId: 'conn-1',
      sessionId: SESSION,
      localPath: path,
      relativePath: 'browser/shot.png',
      bytes: 9,
    })
    expect(acquired).toBeNull()
    expect(filed).toEqual([])
    expect(filed).toEqual([])
    expect(failedHandoffs(SESSION)).toEqual([])
    // And no claim was taken on a file that was removed with its session.
    expect(activeWriteAt(SESSION, path)).toBeNull()
  })

  it('drops the protection and the retry when the session itself is deleted', async () => {
    vi.useFakeTimers()
    node.deferFails = true
    const { registerDownload, reserveDownloadPath, queueDownloadUpload } = await import('../agent/browser-download-store')
    const path = reserveDownloadPath('report.csv', join(zone.userData, 'sync', SESSION, 'download'), SESSION, { connectionId: 'conn-1' })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path, 'ALL-BYTES')
    registerDownload(SESSION, path, true)
    queueDownloadUpload('conn-1', SESSION, path)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(failedHandoffs(SESSION)).toHaveLength(1)

    // Nothing left to hand to the node, and the claim would outlive everything
    // that could release it.
    dropSessionHandoffs(SESSION)
    expect(failedHandoffs(SESSION)).toEqual([])
    expect(activeWriteAt(SESSION, path)).toBeNull()
  })
})
