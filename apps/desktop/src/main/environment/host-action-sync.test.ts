/**
 * What the executor does around one Host Action for a remote session:
 * outputs pushed and rewritten inside the claim budget (session-sync-zone.md §3, §4.1),
 * inputs mapped back to the desktop mirror (§3.1).
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactPutRequest } from '@superone/shared/environment'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))

import { mapHostActionInputs, syncHostActionOutputs, CLAIM_BUDGET_MARGIN_MS } from './host-action-sync'

let root: string
const zone = { syncRoot: '/home/node/.superone/node/sync', os: 'linux' as const }

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ha-sync-'))
  state.userData = root
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function desktopFile(sessionId: string, rel: string, data: string | Buffer): string {
  const path = join(root, 'sync', sessionId, ...rel.split('/'))
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, data)
  return path
}

function fakeNode() {
  const files = new Map<string, Buffer>()
  const parts = new Map<string, Buffer[]>()
  const puts: ArtifactPutRequest[] = []
  const deferred: string[] = []
  return {
    files,
    puts,
    deferred,
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
      transfers: {
        throughputBytesPerMs: () => 1024,
        recordThroughput: () => {},
        defer: (input: { relativePath: string }) => { deferred.push(input.relativePath) },
      },
    },
  }
}

describe('host action outputs', () => {
  it('pushes a screenshot the reply names and rewrites its path to the node twin', async () => {
    const node = fakeNode()
    const shot = desktopFile('s1', 'browser/shot.png', 'png-bytes')
    const reply = { content: [{ type: 'text', text: JSON.stringify({ path: shot, width: 10, height: 10, imageNote: 'call Read on path' }) }] }
    const out = await syncHostActionOutputs('s1', [{ path: shot, producer: 'browser', final: true }], reply, Date.now() + 60_000, node.deps)
    expect(JSON.parse(out.content![0].text!)).toMatchObject({ path: '/home/node/.superone/node/sync/s1/browser/shot.png', width: 10 })
    expect(node.files.get('browser/shot.png')!.toString()).toBe('png-bytes')
    expect(out.sync).toBeUndefined()
  })

  it('does not push a registered file the reply never mentions, but pushes the optimized sibling it does', async () => {
    const node = fakeNode()
    const original = desktopFile('s1', 'computer-use/a.png', Buffer.alloc(100, 1))
    const agent = desktopFile('s1', 'computer-use/a.agent.jpg', 'jpeg')
    const reply = { content: [{ type: 'text', text: JSON.stringify({ image: { path: agent } }) }] }
    const out = await syncHostActionOutputs('s1', [
      { path: original, producer: 'computer-use', final: true },
      { path: agent, producer: 'computer-use', final: true },
    ], reply, Date.now() + 60_000, node.deps)
    expect([...node.files.keys()]).toEqual(['computer-use/a.agent.jpg'])
    expect(out.content![0].text).toContain('/home/node/.superone/node/sync/s1/computer-use/a.agent.jpg')
  })

  it('defers a file that cannot fit the claim budget, still rewrites its path, and says so in the reply', async () => {
    const node = fakeNode()
    const small = desktopFile('s1', 'browser/small.png', 'x')
    const big = desktopFile('s1', 'recording/clip.mp4', Buffer.alloc(50 * 1024))
    const reply = { content: [{ type: 'text', text: `${small}\n${big}` }] }
    // 1 KiB/ms throughput; 50 KiB needs 50 ms but the claim leaves only the margin plus 20 ms.
    const claimExpiresAt = Date.now() + CLAIM_BUDGET_MARGIN_MS + 20
    const out = await syncHostActionOutputs('s1', [
      { path: big, producer: 'recording', final: true },
      { path: small, producer: 'browser', final: true },
    ], reply, claimExpiresAt, node.deps)
    expect(node.files.has('browser/small.png')).toBe(true)
    expect(node.files.has('recording/clip.mp4')).toBe(false)
    expect(node.deferred).toEqual(['recording/clip.mp4'])
    expect(out.sync).toEqual({ deferred: ['/home/node/.superone/node/sync/s1/recording/clip.mp4'] })
    expect(out.content![0].text).toBe('/home/node/.superone/node/sync/s1/browser/small.png\n/home/node/.superone/node/sync/s1/recording/clip.mp4')
  })

  it('leaves non-final refs, other sessions and files outside the zone alone', async () => {
    const node = fakeNode()
    const started = desktopFile('s1', 'recording/live.mp4', 'partial')
    const other = desktopFile('s2', 'browser/theirs.png', 'x')
    const reply = { content: [{ type: 'text', text: `${started} ${other} /tmp/elsewhere.png` }] }
    const out = await syncHostActionOutputs('s1', [
      { path: started, producer: 'recording', final: false },
      { path: other, producer: 'browser', final: true },
      { path: '/tmp/elsewhere.png', producer: 'browser', final: true },
    ], reply, Date.now() + 60_000, node.deps)
    expect(node.puts).toEqual([])
    expect(out).toEqual(reply)
  })

  it('hands a failed push to a job instead of failing the action', async () => {
    const node = fakeNode()
    const shot = desktopFile('s1', 'browser/shot.png', 'png')
    node.deps.put = async () => { throw Object.assign(new Error('node closed the socket'), { code: 'unavailable' }) }
    const reply = { content: [{ type: 'text', text: shot }] }
    const out = await syncHostActionOutputs('s1', [{ path: shot, producer: 'browser', final: true }], reply, Date.now() + 60_000, node.deps)
    expect(node.deferred).toEqual(['browser/shot.png'])
    expect(out.sync).toEqual({ deferred: ['/home/node/.superone/node/sync/s1/browser/shot.png'] })
  })

  it('stops at the abort signal between uploads', async () => {
    const node = fakeNode()
    const abort = new AbortController()
    const a = desktopFile('s1', 'browser/a.png', 'a')
    const b = desktopFile('s1', 'browser/b.png', 'bb')
    const put = node.deps.put
    node.deps = { ...node.deps, signal: abort.signal, put: async (req) => { const r = await put(req); abort.abort(); return r } }
    await expect(syncHostActionOutputs('s1', [
      { path: a, producer: 'browser', final: true },
      { path: b, producer: 'browser', final: true },
    ], { content: [{ type: 'text', text: `${a} ${b}` }] }, Date.now() + 60_000, node.deps)).rejects.toMatchObject({ code: 'aborted' })
    expect(node.puts).toHaveLength(1)
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

  it('leaves project paths and plain strings untouched', async () => {
    const node = fakeNode()
    const args = { path: '/home/node/project/a.png', note: 'sync/s1 in prose' }
    expect(await mapHostActionInputs(args, node.deps)).toEqual(args)
  })
})
