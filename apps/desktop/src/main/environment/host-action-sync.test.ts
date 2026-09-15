/**
 * What the executor does around one Host Action for a remote session:
 * outputs pushed and rewritten inside the claim budget (session-sync-zone.md §3, §4.1),
 * inputs mapped back to the desktop mirror (§3.1).
 *
 * Every output is a delivery record (session-sync-zone-delivery-record.md):
 * the row says whether there is anything to push, and what the push leaves
 * behind for the worker is read back from the row, not from a queue.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactPutRequest } from '@superone/shared/environment'
import { ARTIFACT_CHUNK_BYTES } from '@superone/shared/environment/artifact-rpc'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
vi.mock('../database', async () => (await import('../../test/fixtures/delivery-db')).deliveryDatabase())

import { findDeliveryByPath, listSessionDeliveries, type DeliveryHandle } from '../db-session-deliveries'
import type { ArtifactRef } from '../mcp/artifact-registry'
import { collectArtifacts, takeArtifacts, takeHeldDeliveries } from '../mcp/artifact-registry'
import { deliveryDb, resetDeliveryDatabase } from '../../test/fixtures/delivery-db'
import { _resetHoldersForTests, isHolderAlive } from './delivery-holders'
import { mapHostActionInputs, mapNestedToolInputs, syncHostActionOutputs, withInputMapping, CLAIM_BUDGET_MARGIN_MS } from './host-action-sync'
import { reserveZoneFile, sealZoneFile } from './zone-delivery'
import { ArtifactTransferService } from './artifact-transfer-service'

let root: string
const zone = { syncRoot: '/home/node/.superone/node/sync', os: 'linux' as const }

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ha-sync-'))
  state.userData = root
  resetDeliveryDatabase()
  _resetHoldersForTests()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function desktopFile(sessionId: string, rel: string, data: string | Buffer): string {
  const path = join(root, 'sync', sessionId, ...rel.split('/'))
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, data)
  return path
}

/** A file a producer wrote and sealed for node `c1`: the ref the registry hands the executor. */
function sealed(sessionId: string, rel: string, data: string | Buffer, producer: ArtifactRef['producer'] = 'browser'): ArtifactRef {
  const path = desktopFile(sessionId, rel, data)
  const deliveryId = sealZoneFile({ sessionId, path, origin: 'produced', connectionId: 'c1', bytes: data })!
  return { path, producer, final: true, deliveryId }
}

/** Seal files inside a Host Action call scope, as a producer does, and drain
 *  the live handles the executor hands the reply-selection (E090-4). */
async function inCall(seals: () => ArtifactRef[]): Promise<{ refs: ArtifactRef[]; held: Map<string, DeliveryHandle> }> {
  const refs = await collectArtifacts('s1', 'call-1', async () => seals(), 'c1')
  const held = new Map(takeHeldDeliveries('s1', 'call-1').map((h) => [h.deliveryId, h]))
  takeArtifacts('s1', 'call-1')
  return { refs, held }
}

/** The row behind a ref, as the worker would find it. */
const rowOf = (ref: ArtifactRef) => findDeliveryByPath('s1', ref.path)!
/** Relative paths of every delivery of `s1` that is not over — what the worker still has to do. */
const stillOwed = () => listSessionDeliveries('s1').filter((r) => r.outcome === null).map((r) => r.relativePath)

function fakeNode() {
  const files = new Map<string, Buffer>()
  const parts = new Map<string, Buffer[]>()
  const puts: ArtifactPutRequest[] = []
  let wakes = 0
  return {
    files,
    puts,
    wakes: () => wakes,
    deps: {
      zone,
      connectionId: 'c1',
      signal: new AbortController().signal,
      put: async (req: ArtifactPutRequest) => {
        puts.push(req)
        const chunks = parts.get(req.transferId) ?? []
        chunks.push(Buffer.from(req.chunk, 'base64'))
        parts.set(req.transferId, chunks)
        const written = chunks.reduce((n, c) => n + c.length, 0)
        if (req.final) {
          const whole = Buffer.concat(chunks)
          expect(createHash('sha256').update(whole).digest('hex')).toBe(req.sha256)
          files.set(req.relativePath, whole)
          return { ok: true as const, bytesWritten: written, mtimeMs: 1_700_000_000_000 }
        }
        return { ok: true as const, bytesWritten: written }
      },
      get: async (req: { relativePath: string; offset: number; maxBytes: number }) => {
        const f = files.get(req.relativePath)!
        const slice = f.subarray(req.offset, req.offset + req.maxBytes)
        return { chunk: slice.toString('base64'), total: f.length, mtimeMs: 1_700_000_000_000, eof: req.offset + slice.length >= f.length }
      },
      stat: async (req: { relativePath: string }) => {
        const f = files.get(req.relativePath)
        return f ? { exists: true, size: f.length, mtimeMs: 1_700_000_000_000 } : { exists: false, size: 0, mtimeMs: 0 }
      },
      list: async (req: { relativePath: string }) => {
        const entries = [...files.entries()]
          .filter(([rel]) => rel.startsWith(req.relativePath + '/'))
          .map(([rel, buf]) => ({ relativePath: rel, size: buf.length, mtimeMs: 1_700_000_000_000 }))
        return { exists: entries.length > 0, entries, truncated: false }
      },
      transfers: {
        throughputBytesPerMs: () => 1024,
        recordThroughput: () => {},
        wake: () => { wakes++ },
      },
    },
  }
}

describe('host action outputs', () => {
  it('pushes a screenshot the reply names, rewrites its path to the node twin, and ends the delivery', async () => {
    const node = fakeNode()
    const shot = sealed('s1', 'browser/shot.png', 'png-bytes')
    const reply = { content: [{ type: 'text', text: JSON.stringify({ path: shot.path, width: 10, height: 10, imageNote: 'call Read on path' }) }] }
    const out = await syncHostActionOutputs('s1', [shot], new Map(), reply, Date.now() + 60_000, node.deps)
    expect(JSON.parse(out.content![0].text!)).toMatchObject({ path: '/home/node/.superone/node/sync/s1/browser/shot.png', width: 10 })
    expect(node.files.get('browser/shot.png')!.toString()).toBe('png-bytes')
    expect(out.sync).toBeUndefined()
    // The reply is the wake: nothing is left for the worker, and the holder is gone.
    expect(rowOf(shot)).toMatchObject({ phase: 'notifying', outcome: 'done', holder: null })
    expect(node.wakes()).toBe(0)
  })

  it('abandons a registered file the reply never mentions, and pushes the optimized sibling it does', async () => {
    // A `computer_use` that optimized a screenshot: both files produced inside
    // the call (so both carry a held handle), the reply names only the optimized
    // one. The unnamed original is abandoned under its own handle — left live,
    // the worker would send it to nobody and the mirror keep it for ever.
    const node = fakeNode()
    const { refs, held } = await inCall(() => [
      sealed('s1', 'computer-use/a.png', Buffer.alloc(100, 1), 'computer-use'),
      sealed('s1', 'computer-use/a.agent.jpg', 'jpeg', 'computer-use'),
    ])
    const [original, agentRef] = refs
    const reply = { content: [{ type: 'text', text: JSON.stringify({ image: { path: agentRef.path } }) }] }
    const out = await syncHostActionOutputs('s1', refs, held, reply, Date.now() + 60_000, node.deps)
    expect([...node.files.keys()]).toEqual(['computer-use/a.agent.jpg'])
    expect(out.content![0].text).toContain('/home/node/.superone/node/sync/s1/computer-use/a.agent.jpg')
    expect(rowOf(original)).toMatchObject({ outcome: 'abandoned', holder: null })
    expect(rowOf(agentRef)).toMatchObject({ outcome: 'done' })
  })

  it('renews the claim for a file that does not fit the budget, and pushes it instead of deferring', async () => {
    const node = fakeNode()
    const big = sealed('s1', 'recording/run.mp4', Buffer.alloc(64 * 1024), 'recording')
    // ~6.5 s at this rate: past the 5 s left on the claim, inside one renewal.
    node.deps.transfers.throughputBytesPerMs = () => 10
    const now = 1_000_000
    node.deps.now = () => now
    const renewals: number[] = []
    node.deps.renewClaim = async (ttlMs: number) => { renewals.push(ttlMs); return now + ttlMs }
    const reply = { content: [{ type: 'text', text: big.path }] }
    const out = await syncHostActionOutputs('s1', [big], new Map(), reply, now + 15_000, node.deps)
    expect(renewals).toHaveLength(1)
    expect(node.files.has('recording/run.mp4')).toBe(true)
    expect(stillOwed()).toEqual([])
    expect(out.sync).toBeUndefined()
  })

  it('queues a file for the worker when the node refuses to renew, rather than running past the claim', async () => {
    const node = fakeNode()
    const big = sealed('s1', 'recording/run.mp4', Buffer.alloc(64 * 1024), 'recording')
    node.deps.transfers.throughputBytesPerMs = () => 10
    node.deps.renewClaim = async () => { throw Object.assign(new Error('deadline expired'), { code: 'failed_precondition' }) }
    const reply = { content: [{ type: 'text', text: big.path }] }
    const out = await syncHostActionOutputs('s1', [big], new Map(), reply, Date.now() + 15_000, node.deps)
    expect(node.puts).toEqual([])
    expect(out.sync).toEqual({ deferred: ['/home/node/.superone/node/sync/s1/recording/run.mp4'] })
    // Not attempted: still complete, still protected, nobody's, and the worker told.
    expect(rowOf(big)).toMatchObject({ phase: 'queued', holder: null, outcome: null })
    expect(node.wakes()).toBe(1)
  })

  it('defers a file that cannot fit the claim budget, still rewrites its path, and says so in the reply', async () => {
    const node = fakeNode()
    const small = sealed('s1', 'browser/small.png', 'x')
    const big = sealed('s1', 'recording/clip.mp4', Buffer.alloc(50 * 1024), 'recording')
    const reply = { content: [{ type: 'text', text: `${small.path}\n${big.path}` }] }
    // 1 KiB/ms throughput; 50 KiB needs 50 ms but the claim leaves only the margin plus 20 ms.
    const claimExpiresAt = Date.now() + CLAIM_BUDGET_MARGIN_MS + 20
    const out = await syncHostActionOutputs('s1', [big, small], new Map(), reply, claimExpiresAt, node.deps)
    expect(node.files.has('browser/small.png')).toBe(true)
    expect(node.files.has('recording/clip.mp4')).toBe(false)
    expect(stillOwed()).toEqual(['recording/clip.mp4'])
    expect(out.sync).toEqual({ deferred: ['/home/node/.superone/node/sync/s1/recording/clip.mp4'] })
    expect(out.content![0].text).toBe('/home/node/.superone/node/sync/s1/browser/small.png\n/home/node/.superone/node/sync/s1/recording/clip.mp4')
  })

  it('leaves non-final refs, other sessions and files outside the zone alone', async () => {
    const node = fakeNode()
    const started = desktopFile('s1', 'recording/live.mp4', 'partial')
    const reservation = reserveZoneFile({ sessionId: 's1', path: started, origin: 'produced', connectionId: 'c1' })!
    const other = sealed('s2', 'browser/theirs.png', 'x')
    const reply = { content: [{ type: 'text', text: `${started} ${other.path} /tmp/elsewhere.png` }] }
    const out = await syncHostActionOutputs('s1', [
      { path: started, producer: 'recording', final: false, deliveryId: reservation },
      other,
      { path: '/tmp/elsewhere.png', producer: 'browser', final: true },
    ], new Map(), reply, Date.now() + 60_000, node.deps)
    expect(node.puts).toEqual([])
    expect(out).toEqual(reply)
    // The writer still holds its reservation.
    const row = findDeliveryByPath('s1', started)!
    expect(row.phase).toBe('writing')
    expect(isHolderAlive(row.holder)).toBe(true)
  })

  it('leaves an upload the node dropped mid-stream for the worker, at its offset, under the same transfer', async () => {
    // Three chunks; the node closes the socket on the second. The first is
    // on the node under this transfer id, and the row says so: the worker
    // resumes from there rather than starting a second transfer.
    const node = fakeNode()
    const big = sealed('s1', 'recording/run.mp4', Buffer.alloc(2 * ARTIFACT_CHUNK_BYTES + 1, 7), 'recording')
    const put = node.deps.put
    node.deps.put = async (req) => {
      if (req.offset === ARTIFACT_CHUNK_BYTES) throw Object.assign(new Error('node closed the socket'), { code: 'unavailable' })
      return put(req)
    }
    const reply = { content: [{ type: 'text', text: big.path }] }
    const out = await syncHostActionOutputs('s1', [big], new Map(), reply, Date.now() + 60_000, node.deps)
    expect(out.sync).toEqual({ deferred: ['/home/node/.superone/node/sync/s1/recording/run.mp4'] })
    const row = rowOf(big)
    expect(row).toMatchObject({ phase: 'uploading', offset: ARTIFACT_CHUNK_BYTES, holder: null, attempts: 1, lastError: 'node closed the socket', gaveUpAt: null })
    expect(row.nextAttemptAt).not.toBeNull()
    expect(node.puts[0]?.transferId).toBe(row.transferId)
    expect(node.wakes()).toBe(1)
  })

  it('stops on a final put whose reply was lost, rather than sending the file again', async () => {
    // The final chunk went out and the answer did not come back. The node
    // may have committed it; the desktop cannot tell (§2), and resending would
    // replace a file the agent may already have changed. The row records the
    // doubt and no worker will act on it automatically.
    const node = fakeNode()
    const shot = sealed('s1', 'browser/shot.png', 'png')
    const put = node.deps.put
    node.deps.put = async (req) => { await put(req); throw Object.assign(new Error('node closed the socket'), { code: 'unavailable' }) }
    const reply = { content: [{ type: 'text', text: shot.path }] }
    const out = await syncHostActionOutputs('s1', [shot], new Map(), reply, Date.now() + 60_000, node.deps)
    // Not "deferred / you will be notified": a committing row is stopped, and
    // the agent is told to re-run rather than wait (E090-3).
    expect(out.sync).toEqual({ deferred: [], stopped: ['/home/node/.superone/node/sync/s1/browser/shot.png'] })
    expect(out.content?.at(-1)?.text).toMatch(/not be retried automatically|re-run/i)
    const row = rowOf(shot)
    expect(row).toMatchObject({ phase: 'committing', holder: null, outcome: null, nextAttemptAt: null })
    expect(row.gaveUpAt).not.toBeNull()
    expect(row.lastError).toMatch(/commit unverified/)
  })

  it('tells the agent about deferred files inside the tool content, not only on the envelope', async () => {
    // `sync` is a SuperOne field on the reply envelope; the node's MCP server
    // forwards only `content`, so a deferred list that lives nowhere else is
    // invisible to the model.
    const node = fakeNode()
    const big = sealed('s1', 'recording/run.mp4', Buffer.alloc(64 * 1024), 'recording')
    node.deps.transfers.throughputBytesPerMs = () => 1
    const reply = { content: [{ type: 'text', text: JSON.stringify({ ok: true, savedPath: big.path }) }] }
    const out = await syncHostActionOutputs('s1', [big], new Map(), reply, Date.now() + 15_000, node.deps)
    expect(out.content).toHaveLength(2)
    expect(out.content[1]?.text).toContain('/home/node/.superone/node/sync/s1/recording/run.mp4')
    expect(out.content[1]?.text).toMatch(/not (yet )?(there|available|synced)/i)
  })

  it('gives up waiting on a put that outruns the claim budget, and records the doubt it leaves', async () => {
    // Aborting the controller does not make a node RPC return. If the sync
    // step waits for it anyway, the claim is gone by the time the reply is
    // built — and the reply is what the agent gets. The put it walked away
    // from was the final one, so what the node did with it is unknowable.
    const node = fakeNode()
    const shot = sealed('s1', 'browser/shot.png', 'png')
    node.deps.put = () => new Promise(() => {})
    const reply = { content: [{ type: 'text', text: shot.path }] }
    const settled = await Promise.race([
      syncHostActionOutputs('s1', [shot], new Map(), reply, Date.now() + CLAIM_BUDGET_MARGIN_MS + 30, node.deps),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 500)),
    ])
    expect(settled).not.toBe('hung')
    expect((settled as { sync?: unknown }).sync).toEqual({ deferred: [], stopped: ['/home/node/.superone/node/sync/s1/browser/shot.png'] })
    expect(rowOf(shot)).toMatchObject({ phase: 'committing', holder: null, nextAttemptAt: null })
    expect(rowOf(shot).gaveUpAt).not.toBeNull()
  })

  it('pushes a ref named in one block of a multi-block reply', async () => {
    // The mention check used to run on every block joined together, while the
    // rewrite ran per block. A JSON block plus a prose block is not JSON, so
    // the joined text parsed as neither and the ref was judged unmentioned —
    // never uploaded, and its path left pointing at the desktop.
    const node = fakeNode()
    // The quote is what makes it visible: JSON escapes it once per nesting
    // level, and the joined text was matched against a single level.
    const shot = sealed('s1', 'browser/a"b.png', 'png-bytes')
    const reply = {
      content: [
        { type: 'text', text: JSON.stringify({ result: JSON.stringify({ path: shot.path }) }) },
        { type: 'text', text: 'Image saved.' },
      ],
    }
    const out = await syncHostActionOutputs('s1', [shot], new Map(), reply, Date.now() + 60_000, node.deps)
    expect(node.files.has('browser/a"b.png')).toBe(true)
    expect(JSON.parse(JSON.parse(out.content![0].text!).result).path).toBe('/home/node/.superone/node/sync/s1/browser/a"b.png')
  })

  it('defers when the claim renewal itself hangs, instead of waiting past the claim it already had', async () => {
    // Asking for more time is another RPC that can stop answering. Waiting on
    // it under no deadline spends exactly the claim the renewal was meant to
    // protect.
    const node = fakeNode()
    const big = sealed('s1', 'recording/run.mp4', Buffer.alloc(64 * 1024), 'recording')
    node.deps.transfers.throughputBytesPerMs = () => 10
    node.deps.renewClaim = () => new Promise(() => {})
    const reply = { content: [{ type: 'text', text: big.path }] }
    const settled = await Promise.race([
      syncHostActionOutputs('s1', [big], new Map(), reply, Date.now() + CLAIM_BUDGET_MARGIN_MS + 30, node.deps),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 500)),
    ])
    expect(settled).not.toBe('hung')
    expect(rowOf(big)).toMatchObject({ phase: 'queued', holder: null })
  })

  it('pushes a file the reply names in Chinese prose, with Chinese punctuation around it', async () => {
    const node = fakeNode()
    const shot = sealed('s1', 'browser/shot.png', 'png-bytes')
    const reply = { content: [{ type: 'text', text: `截图已保存到 ${shot.path}，请查看。` }] }
    const out = await syncHostActionOutputs('s1', [shot], new Map(), reply, Date.now() + 60_000, node.deps)
    expect(node.files.has('browser/shot.png')).toBe(true)
    expect(out.content![0].text).toBe('截图已保存到 /home/node/.superone/node/sync/s1/browser/shot.png，请查看。')
  })

  it('rewrites without re-uploading a file whose delivery the node already has', async () => {
    // A download the worker carried before the agent listed it; a recording
    // listed twice. The record says the bytes are there (or only the wake is
    // owed, which is the worker's), so the reply is rewritten and nothing sent.
    const node = fakeNode()
    const shot = sealed('s1', 'browser/shot.png', 'png-bytes')
    for (const [phase, outcome] of [['uploaded', null], ['notifying', null], ['notifying', 'done']] as const) {
      deliveryDb().prepare('UPDATE session_file_deliveries SET phase = ?, outcome = ? WHERE delivery_id = ?').run(phase, outcome, shot.deliveryId)
      const reply = { content: [{ type: 'text', text: shot.path }] }
      const out = await syncHostActionOutputs('s1', [shot], new Map(), reply, Date.now() + 60_000, node.deps)
      expect(node.puts, `${phase}/${outcome}`).toHaveLength(0)
      expect(out.content![0].text).toBe('/home/node/.superone/node/sync/s1/browser/shot.png')
      expect(out.sync).toBeUndefined()
    }
  })

  it('defers a file another push or the worker is delivering right now, rather than sending it beside them', async () => {
    const node = fakeNode()
    const shot = sealed('s1', 'browser/shot.png', 'png-bytes')
    // Someone alive holds it: a second action naming the same file joins them.
    const { mintHolder } = await import('./delivery-holders')
    deliveryDb().prepare(`UPDATE session_file_deliveries SET phase = 'uploading', holder = ? WHERE delivery_id = ?`).run(mintHolder(), shot.deliveryId)
    const reply = { content: [{ type: 'text', text: shot.path }] }
    const out = await syncHostActionOutputs('s1', [shot], new Map(), reply, Date.now() + 60_000, node.deps)
    expect(node.puts).toHaveLength(0)
    expect(out.sync).toEqual({ deferred: ['/home/node/.superone/node/sync/s1/browser/shot.png'] })
    expect(rowOf(shot).phase).toBe('uploading')
  })

  it('stops at the abort signal, leaving files it did not reach sealed for the worker', async () => {
    // The action is cancelled the instant the first file's final put is
    // confirmed. That confirmed commit is honoured — not reported as needing
    // re-delivery for a file already on the node — and the second file, never
    // reached, stays sealed and unheld for the worker. The call throws the
    // action's own abort, not the push's error.
    const node = fakeNode()
    const abort = new AbortController()
    const a = sealed('s1', 'browser/a.png', 'a')
    const b = sealed('s1', 'browser/b.png', 'bb')
    const put = node.deps.put
    node.deps = { ...node.deps, signal: abort.signal, put: async (req) => { const r = await put(req); abort.abort(); return r } }
    await expect(syncHostActionOutputs('s1', [a, b], new Map(), { content: [{ type: 'text', text: `${a.path} ${b.path}` }] }, Date.now() + 60_000, node.deps))
      .rejects.toMatchObject({ code: 'aborted' })
    expect(node.puts).toHaveLength(1)
    // The first file's final put was confirmed before the abort surfaced, so
    // it is honoured as delivered rather than discarded; the second, never
    // reached, stays sealed and unheld for the worker.
    expect(rowOf(a)).toMatchObject({ phase: 'notifying', outcome: 'done', holder: null })
    expect(rowOf(b)).toMatchObject({ phase: 'sealed', holder: null, outcome: null })
  })

  it('does not report a confirmed upload as needing re-delivery when only the wake write fails (E090-2)', async () => {
    // The PUT lands and the row reaches `uploaded` — the bytes are on the node.
    // Then the completion write (`outcome = 'done'`) fails. Because the commit
    // is already confirmed, this is an ordinary retryable failure of the wake,
    // never "commit unverified": the file is there, only the notice is owed.
    const node = fakeNode()
    const shot = sealed('s1', 'browser/shot.png', 'png')
    const real = deliveryDb().prepare.bind(deliveryDb())
    const spy = vi.spyOn(deliveryDb(), 'prepare').mockImplementation(((sql: string) => {
      if (sql.includes("outcome = 'done'")) throw new Error('SQLITE_BUSY')
      return real(sql)
    }) as never)
    const out = await syncHostActionOutputs('s1', [shot], new Map(), { content: [{ type: 'text', text: shot.path }] }, Date.now() + 60_000, node.deps)
    spy.mockRestore()
    expect(node.files.get('browser/shot.png')?.toString()).toBe('png')
    // The bytes are on the node; the row is at `notifying`, retryable, NOT a
    // committing/gave-up "needs re-delivery".
    const row = rowOf(shot)
    expect(row).toMatchObject({ phase: 'notifying', outcome: null, gaveUpAt: null })
    expect(row.lastError ?? '').not.toMatch(/commit unverified/)
    expect(out.sync).toMatchObject({ deferred: ['/home/node/.superone/node/sync/s1/browser/shot.png'] })
    expect((out.sync as { stopped?: string[] }).stopped).toBeUndefined()
    // A worker pass with the DB healthy finishes the wake.
    const service = new ArtifactTransferService({ put: (_c, req) => node.deps.put(req), notifyCompleted: async () => undefined })
    await service.runOnce('c1')
    expect(rowOf(shot)).toMatchObject({ outcome: 'done' })
  })

  it('keeps reporting a stopped committing file as stopped when it is observed again, never as deferred (E090-3)', async () => {
    // The first eager push sends the file's only (final) chunk; its reply is
    // lost, so the row lands in `committing` and gives up (§6) — reported
    // `stopped`. A later download listing observes the same path (same delivery
    // id, no new row). Re-syncing it must keep saying stopped: no worker will
    // carry a committing row, so a deferred "you will be notified" is a promise
    // nothing keeps (E090-3).
    const node = fakeNode()
    const shot = sealed('s1', 'browser/shot.png', 'png')
    let puts = 0
    node.deps.put = async () => { puts++; throw Object.assign(new Error('link dropped'), { code: 'unavailable' }) }
    const reply = { content: [{ type: 'text', text: shot.path }] }
    const out1 = await syncHostActionOutputs('s1', [shot], new Map(), reply, Date.now() + 60_000, node.deps)
    expect(puts).toBe(1)
    expect(rowOf(shot).phase).toBe('committing')
    expect(rowOf(shot).gaveUpAt).not.toBeNull()
    expect(out1.sync).toMatchObject({ stopped: ['/home/node/.superone/node/sync/s1/browser/shot.png'] })
    expect((out1.sync as { deferred: string[] }).deferred).toEqual([])
    // Observed again (a `browser_download` listing names the same path): same
    // delivery id, still committing/gave-up. It must not turn into a deferred wake.
    const out2 = await syncHostActionOutputs('s1', [shot], new Map(), reply, Date.now() + 60_000, node.deps)
    expect(puts).toBe(1)
    expect(out2.sync).toMatchObject({ stopped: ['/home/node/.superone/node/sync/s1/browser/shot.png'] })
    expect((out2.sync as { deferred: string[] }).deferred).toEqual([])
    expect(node.wakes()).toBe(0)
  })

  it('reports a committing file whose executor still holds it as on its way, not stopped (E090-3)', async () => {
    // A normal final put is IN FLIGHT: the row is committing, held by a live
    // holder (its executor). Observing it must say deferred — that executor will
    // complete and wake the agent — not stopped, which would tell the agent to
    // re-run a put that is about to confirm.
    const node = fakeNode()
    const shot = sealed('s1', 'browser/shot.png', 'png')
    const { mintHolder } = await import('./delivery-holders')
    const holder = mintHolder()
    deliveryDb().prepare(`UPDATE session_file_deliveries SET phase = 'committing', holder = ? WHERE delivery_id = ?`).run(holder, shot.deliveryId)
    const out = await syncHostActionOutputs('s1', [shot], new Map(), { content: [{ type: 'text', text: shot.path }] }, Date.now() + 60_000, node.deps)
    expect(out.sync).toMatchObject({ deferred: ['/home/node/.superone/node/sync/s1/browser/shot.png'] })
    expect((out.sync as { stopped?: string[] }).stopped).toBeUndefined()
    // We did not touch the row — its executor owns it — and it is unchanged.
    expect(node.puts).toHaveLength(0)
    expect(rowOf(shot)).toMatchObject({ phase: 'committing', holder })
  })

  it('reports a file whose automatic upload gave up as needing a Settings retry, not a deferred wake (E090-3)', async () => {
    // A real retry exhaustion, not a hand-set phase: a two-chunk file whose FIRST
    // (non-final) put always fails backs off at `uploading` and, after
    // MAX_UPLOAD_ATTEMPTS, gives up. The worker's own query excludes gave-up rows,
    // so observing it must NOT promise a completion notice (deferred), nor claim a
    // sent-but-unconfirmed put (stopped) — only a person's Settings → Retry Upload
    // recovers it.
    const node = fakeNode()
    const big = sealed('s1', 'recording/run.mp4', Buffer.alloc(ARTIFACT_CHUNK_BYTES + 1, 7), 'recording')
    let clock = 1_000_000
    const service = new ArtifactTransferService({
      put: async (_c: string, req: ArtifactPutRequest) => {
        if (!req.final) throw Object.assign(new Error('link down'), { code: 'unavailable' })
        return node.deps.put(req)
      },
      now: () => clock,
    })
    for (let i = 0; i < 8; i++) {
      await service.runOnce('c1')
      const row = rowOf(big)
      if (row.nextAttemptAt) clock = row.nextAttemptAt + 1
    }
    const gaveUp = rowOf(big)
    expect(gaveUp).toMatchObject({ phase: 'uploading', outcome: null, attempts: 8 })
    expect(gaveUp.gaveUpAt).not.toBeNull()
    expect(node.files.has('recording/run.mp4')).toBe(false)
    // Observed now, mid another action: not on its way, not a lost commit.
    const out = await syncHostActionOutputs('s1', [big], new Map(), { content: [{ type: 'text', text: big.path }] }, Date.now() + 60_000, node.deps)
    const sync = out.sync as { deferred: string[]; stopped?: string[]; retryRequired?: string[] }
    expect(sync.retryRequired).toEqual(['/home/node/.superone/node/sync/s1/recording/run.mp4'])
    expect(sync.deferred).toEqual([])
    expect(sync.stopped).toBeUndefined()
    expect(node.wakes()).toBe(0)
    expect(out.content!.some((b) => /Retry Upload/i.test(b.text ?? ''))).toBe(true)
    // Only Settings' Retry Upload puts it back in the queue.
    expect(service.retryGivenUp('s1')).toMatchObject({ retried: 1 })
  })

  it('does not abandon a file it only observed; the original worker still delivers it (E090-4)', async () => {
    // A background page-download sealed the file outside any call — worker-
    // eligible, sealed and unheld. A different call (a perf wrapper) observes the
    // same path but does NOT own it (held is empty) and names only timings.
    // Nothing this call does may end that delivery: its authority is its own
    // held handles, not an id-only claim on a row that merely happens to be free.
    const node = fakeNode()
    const probe = sealed('s1', 'download/report.bin', 'BYTES', 'download')
    expect(rowOf(probe)).toMatchObject({ phase: 'sealed', holder: null })
    const out = await syncHostActionOutputs('s1', [probe], new Map(), { content: [{ type: 'text', text: JSON.stringify({ ms: 5 }) }] }, Date.now() + 60_000, node.deps)
    expect(out.sync).toBeUndefined()
    // Not abandoned — still sealed for the worker, which delivers it.
    expect(rowOf(probe)).toMatchObject({ phase: 'sealed', outcome: null })
    const service = new ArtifactTransferService({ put: (_c, req) => node.deps.put(req), notifyCompleted: async () => undefined })
    await service.runOnce('c1')
    expect(node.files.get('download/report.bin')?.toString()).toBe('BYTES')
    expect(rowOf(probe)).toMatchObject({ outcome: 'done' })
  })

  it('retires every held holder even when an unmentioned abandon write throws (E090-4 owner lifecycle)', async () => {
    // Two files produced in-call (both held), reply names neither. The first
    // abandon UPDATE throws mid-selection. The function must still retire BOTH
    // holders — the throwing one via its own finally, the untouched one via the
    // whole-function finally — never leave a live holder stranding the mirror.
    const node = fakeNode()
    const { refs, held } = await inCall(() => [
      sealed('s1', 'computer-use/a.png', Buffer.alloc(10, 1), 'computer-use'),
      sealed('s1', 'computer-use/b.png', Buffer.alloc(10, 2), 'computer-use'),
    ])
    const holders = [...held.values()].map((h) => h.holder)
    const real = deliveryDb().prepare.bind(deliveryDb())
    let threw = false
    const spy = vi.spyOn(deliveryDb(), 'prepare').mockImplementation(((sql: string) => {
      if (!threw && sql.includes("outcome = 'abandoned'")) { threw = true; throw new Error('SQLITE_BUSY') }
      return real(sql)
    }) as never)
    await expect(
      syncHostActionOutputs('s1', refs, held, { content: [{ type: 'text', text: JSON.stringify({ ms: 1 }) }] }, Date.now() + 60_000, node.deps),
    ).rejects.toThrow()
    spy.mockRestore()
    // No call-owned holder survives — nothing is left live-held to strand the row.
    for (const holder of holders) expect(isHolderAlive(holder)).toBe(false)
    // Both rows are recoverable (sealed, dead/unheld); a healthy worker carries them.
    const service = new ArtifactTransferService({ put: (_c, req) => node.deps.put(req), notifyCompleted: async () => undefined })
    await service.runOnce('c1')
    for (const holder of holders) expect(isHolderAlive(holder)).toBe(false)
    expect(listSessionDeliveries('s1').every((r) => r.holder === null)).toBe(true)
  })
})

describe('the scope→selection handoff a worker could race (E090-4)', () => {
  // Replay the executor's own sequence around a produced file: a tool seals it
  // inside its call scope; the scope ends; the held handle is handed to the
  // reply-selection (`takeHeldDeliveries` → `syncHostActionOutputs(held)`). The
  // row stays held — a live holder — from the seal, ACROSS the scope end, until
  // the selection decides. A worker pass run in the gap between the two (the
  // exact window the old code released the holder in) must therefore take
  // nothing, whether the reply names the file or not.

  it('holds a produced file across the handoff so a worker in the gap cannot take it, then abandons the unnamed one (E090-4)', async () => {
    const node = fakeNode()
    const service = new ArtifactTransferService({ put: (_c, req) => node.deps.put(req), notifyCompleted: async () => undefined })
    const probePath = join(root, 'sync', 's1', 'download', 'probe.bin')
    let deliveryId = ''
    const reply = await collectArtifacts('s1', 'call-1', async () => {
      const path = desktopFile('s1', 'download/probe.bin', 'BYTES')
      deliveryId = sealZoneFile({ sessionId: 's1', path, origin: 'download', connectionId: 'c1' })!
      return { content: [{ type: 'text', text: JSON.stringify({ ms: 1234 }) }] }
    }, 'c1')
    const held = new Map(takeHeldDeliveries('s1', 'call-1').map((h) => [h.deliveryId, h]))
    takeArtifacts('s1', 'call-1')
    // The worker runs in the handoff gap. The row is still held (a live holder),
    // so it sends nothing — this is what the released-at-scope-end code failed.
    await service.runOnce('c1')
    expect(node.puts).toHaveLength(0)
    expect(findDeliveryByPath('s1', probePath)).toMatchObject({ phase: 'sealed', outcome: null })
    expect(isHolderAlive(findDeliveryByPath('s1', probePath)!.holder!)).toBe(true)
    // The reply names only timings: the selection abandons the file under the
    // handle it kept — never a fresh claim on an unheld row.
    const probe = { path: probePath, producer: 'download' as const, final: true, deliveryId }
    await syncHostActionOutputs('s1', [probe], held, reply, Date.now() + 60_000, node.deps)
    expect(findDeliveryByPath('s1', probePath)).toMatchObject({ outcome: 'abandoned', holder: null })
    await service.runOnce('c1')
    expect(node.puts).toHaveLength(0)
  })

  it('delivers a produced file the reply names, under the handle it held across the gap (E090-4)', async () => {
    const node = fakeNode()
    const service = new ArtifactTransferService({ put: (_c, req) => node.deps.put(req), notifyCompleted: async () => undefined })
    const shotPath = join(root, 'sync', 's1', 'browser', 'shot.png')
    let deliveryId = ''
    const reply = await collectArtifacts('s1', 'call-1', async () => {
      const path = desktopFile('s1', 'browser/shot.png', 'png')
      deliveryId = sealZoneFile({ sessionId: 's1', path, origin: 'produced', connectionId: 'c1' })!
      return { content: [{ type: 'text', text: path }] }
    }, 'c1')
    const held = new Map(takeHeldDeliveries('s1', 'call-1').map((h) => [h.deliveryId, h]))
    takeArtifacts('s1', 'call-1')
    // Worker in the gap: still held, so nothing is sent.
    await service.runOnce('c1')
    expect(node.puts).toHaveLength(0)
    // The selection pushes it under the same holder the call kept — no window in
    // which it was a sealed, unheld row.
    const shot = { path: shotPath, producer: 'browser' as const, final: true, deliveryId }
    const out = await syncHostActionOutputs('s1', [shot], held, reply, Date.now() + 60_000, node.deps)
    expect(node.files.get('browser/shot.png')?.toString()).toBe('png')
    expect(out.content![0].text).toBe('/home/node/.superone/node/sync/s1/browser/shot.png')
    expect(findDeliveryByPath('s1', shotPath)).toMatchObject({ phase: 'notifying', outcome: 'done', holder: null })
  })
})

describe('host action inputs', () => {
  it('maps a node zone path in the args to the desktop mirror, fetching it first', async () => {
    const node = fakeNode()
    node.files.set('agent/chart.png', Buffer.from('chart'))
    const args = { title: 'g', template: '@native/image-gallery', data: { images: [{ path: '/home/node/.superone/node/sync/s1/agent/chart.png' }] } }
    const mapped = await mapHostActionInputs(args, node.deps)
    const local = join(root, 'sync', 's1', 'agent', 'chart.png')
    expect(mapped).toEqual({ title: 'g', template: '@native/image-gallery', data: { images: [{ path: local }] } })
    expect(readFileSync(local, 'utf8')).toBe('chart')
  })

  it('refuses to map another session zone path into this call', async () => {
    // A Host Action for s1 may only reach s1's zone. Mapping s2's path would
    // hand this tool a file from a session it is not running for.
    const node = fakeNode()
    const args = { path: '/home/node/.superone/node/sync/s2/agent/secret.md' }
    await expect(mapHostActionInputs(args, { ...node.deps, sessionId: 's1' })).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('fails the call when the node has an input file it could not hand over', async () => {
    // Running the tool on whatever happens to be at the desktop path instead
    // is how a stale or foreign file reaches the model.
    const node = fakeNode()
    node.files.set('agent/ref.png', Buffer.from('node bytes'))
    node.deps.get = async () => { throw Object.assign(new Error('socket closed'), { code: 'unavailable' }) }
    const args = { path: '/home/node/.superone/node/sync/s1/agent/ref.png' }
    await expect(mapHostActionInputs(args, { ...node.deps, sessionId: 's1' })).rejects.toBeTruthy()
  })

  it('refuses to run a tool on a source file the node does not have', async () => {
    // `missing` used to be allowed for every argument, on the theory that the
    // tool might be about to write it. For a source that means running on
    // whatever stale copy sits at the desktop path.
    const node = fakeNode()
    const args = { reference_image_paths: ['/home/node/.superone/node/sync/s1/agent/gone.png'] }
    await expect(mapHostActionInputs(args, { ...node.deps, sessionId: 's1', toolName: 'media_generate_image' }))
      .rejects.toMatchObject({ code: 'not_found' })
  })

  it('reports a node that refuses to stat as unavailable, not as a file that is simply not there', async () => {
    const node = fakeNode()
    node.deps.stat = async () => { throw Object.assign(new Error('nope'), { code: 'forbidden' }) }
    const args = { reference_image_paths: ['/home/node/.superone/node/sync/s1/agent/ref.png'] }
    await expect(mapHostActionInputs(args, { ...node.deps, sessionId: 's1', toolName: 'media_generate_image' }))
      .rejects.toMatchObject({ code: 'unavailable' })
  })

  it("lets a tool's declared output directory through even though nothing is there yet", async () => {
    // `browser_download.dir` names where the file will go. Requiring it to
    // exist would make the one argument that is meant to be new impossible.
    const node = fakeNode()
    const args = { action: 'download', dir: '/home/node/.superone/node/sync/s1/download/reports' }
    const mapped = await mapHostActionInputs(args, { ...node.deps, sessionId: 's1', toolName: 'browser_download' })
    expect(mapped.dir).toBe(join(root, 'sync', 's1', 'download', 'reports'))
  })

  it('keeps the source rule for a path one call names as both source and destination, in either order', async () => {
    // Refs used to be de-duplicated by path and keep only the first argument
    // name seen — so a destination named first laundered the same path's
    // use as a source. A path's roles are all of the roles it was given.
    const node = fakeNode()
    const p = '/home/node/.superone/node/sync/s1/download/x.bin'
    desktopFile('s1', 'download/x.bin', 'stale')
    for (const args of [{ action: 'download', dir: p, url: p }, { action: 'download', url: p, dir: p }]) {
      await expect(mapHostActionInputs(args, { ...node.deps, sessionId: 's1', toolName: 'browser_network' }))
        .rejects.toMatchObject({ code: 'not_found' })
    }
  })

  it('leaves a wrapped call alone at the outer boundary and maps it where the inner tool runs', async () => {
    // `browser_perf` carries another tool's arguments; a saved `browser_action`
    // carries values that only become arguments after template expansion.
    // Neither can be judged at the outer boundary, so their contents are
    // left as the node wrote them and mapped by the inner tool's own roles.
    const node = fakeNode()
    const dir = '/home/node/.superone/node/sync/s1/download/reports'
    const perf = await mapHostActionInputs(
      { action: { tool: 'browser_download', args: { url: 'https://x/y.pdf', dir } } },
      { ...node.deps, sessionId: 's1', toolName: 'browser_perf' },
    )
    expect((perf.action as { args: { dir: string } }).args.dir).toBe(dir)
    const saved = await mapHostActionInputs(
      { action: 'do', name: 'export', input: { dir } },
      { ...node.deps, sessionId: 's1', toolName: 'browser_action' },
    )
    expect((saved.input as { dir: string }).dir).toBe(dir)

    // The inner boundary: the same dir, as the primitive sees it.
    const inner = await withInputMapping({ ...node.deps, sessionId: 's1' }, () => mapNestedToolInputs('browser_download', { url: 'https://x/y.pdf', dir }))
    expect(inner.dir).toBe(join(root, 'sync', 's1', 'download', 'reports'))
    // And a source the inner tool names still has to exist.
    await expect(withInputMapping({ ...node.deps, sessionId: 's1' }, () => mapNestedToolInputs('browser_upload', { path: dir })))
      .rejects.toMatchObject({ code: 'not_found' })
    // Outside a Host Action there is nothing to map.
    expect(await mapNestedToolInputs('browser_download', { dir })).toEqual({ dir })
  })

  it('recognises the download destination under the public tool name and action, not only the internal one', async () => {
    // The node's catalog publishes `browser_network`; `action: "download"` is
    // only split off into `browser_download` after the inputs are mapped.
    const node = fakeNode()
    const dir = '/home/node/.superone/node/sync/s1/download/reports'
    const ok = await mapHostActionInputs({ action: 'download', url: 'https://x/y.pdf', dir }, { ...node.deps, sessionId: 's1', toolName: 'browser_network' })
    expect(ok.dir).toBe(join(root, 'sync', 's1', 'download', 'reports'))
    await expect(mapHostActionInputs({ action: 'body', requestId: dir }, { ...node.deps, sessionId: 's1', toolName: 'browser_network' }))
      .rejects.toMatchObject({ code: 'not_found' })
  })

  it("lets a mini-app scaffold name a project directory that does not exist yet", async () => {
    // `projectDir` is where the dev pointer is written; the service creates it.
    const node = fakeNode()
    const args = { directory: '/home/node/.superone/node/sync/s1/agent/app', projectDir: '/home/node/.superone/node/sync/s1/agent', scope: 'project' }
    await expect(mapHostActionInputs(args, { ...node.deps, sessionId: 's1', toolName: 'miniapp_dev_setup' })).resolves.toBeTruthy()
    await expect(mapHostActionInputs({ directory: '/home/node/project/app', projectDir: args.projectDir }, { ...node.deps, sessionId: 's1', toolName: 'miniapp_dev_register' })).resolves.toBeTruthy()
  })

  it('mirrors a whole directory the tool will read, file by file, and refuses one the node does not have', async () => {
    // `artifact.stat` knows files; a directory argument is answered by
    // listing it and mirroring every member, so the tool reads the node's
    // tree and not whatever the desktop side held last time.
    const node = fakeNode()
    node.files.set('agent/app/manifest.json', Buffer.from('{"appId":"x"}'))
    node.files.set('agent/app/src/index.js', Buffer.from('export {}'))
    const app = '/home/node/.superone/node/sync/s1/agent/app'
    const mapped = await mapHostActionInputs({ directory: app }, { ...node.deps, sessionId: 's1', toolName: 'miniapp_dev_register' })
    expect(mapped.directory).toBe(join(root, 'sync', 's1', 'agent', 'app'))
    expect(readFileSync(join(root, 'sync', 's1', 'agent', 'app', 'manifest.json'), 'utf8')).toBe('{"appId":"x"}')
    expect(readFileSync(join(root, 'sync', 's1', 'agent', 'app', 'src', 'index.js'), 'utf8')).toBe('export {}')
    await expect(mapHostActionInputs({ appDir: '/home/node/.superone/node/sync/s1/agent/none' }, { ...node.deps, sessionId: 's1', toolName: 'miniapp_dev_update_types' }))
      .rejects.toMatchObject({ code: 'not_found' })
  })

  it('leaves project paths and plain strings untouched', async () => {
    const node = fakeNode()
    const args = { path: '/home/node/project/a.png', note: 'sync/s1 in prose' }
    expect(await mapHostActionInputs(args, node.deps)).toEqual(args)
  })
})
