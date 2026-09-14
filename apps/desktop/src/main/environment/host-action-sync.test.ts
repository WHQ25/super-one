/**
 * What the executor does around one Host Action for a remote session:
 * outputs pushed and rewritten inside the claim budget (session-sync-zone.md §3, §4.1),
 * inputs mapped back to the desktop mirror (§3.1).
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactPutRequest } from '@superone/shared/environment'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))

import { mapHostActionInputs, mapNestedToolInputs, syncHostActionOutputs, withInputMapping, CLAIM_BUDGET_MARGIN_MS } from './host-action-sync'

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
  const deferredJobs: { relativePath: string; transferId?: string }[] = []
  return {
    files,
    puts,
    deferred,
    deferredJobs,
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
        defer: (input: { relativePath: string; transferId?: string }) => { deferred.push(input.relativePath); deferredJobs.push(input) },
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

  it('renews the claim for a file that does not fit the budget, and pushes it instead of deferring', async () => {
    const node = fakeNode()
    const big = desktopFile('s1', 'recording/run.mp4', Buffer.alloc(64 * 1024))
    // ~6.5 s at this rate: past the 5 s left on the claim, inside one renewal.
    node.deps.transfers.throughputBytesPerMs = () => 10
    const now = 1_000_000
    node.deps.now = () => now
    const renewals: number[] = []
    node.deps.renewClaim = async (ttlMs: number) => { renewals.push(ttlMs); return now + ttlMs }
    const reply = { content: [{ type: 'text', text: big }] }
    const out = await syncHostActionOutputs('s1', [{ path: big, producer: 'recording', final: true }], reply, now + 15_000, node.deps)
    expect(renewals).toHaveLength(1)
    expect(node.files.has('recording/run.mp4')).toBe(true)
    expect(node.deferred).toEqual([])
    expect(out.sync).toBeUndefined()
  })

  it('defers when the node refuses to renew, rather than running past the claim', async () => {
    const node = fakeNode()
    const big = desktopFile('s1', 'recording/run.mp4', Buffer.alloc(64 * 1024))
    node.deps.transfers.throughputBytesPerMs = () => 10
    node.deps.renewClaim = async () => { throw Object.assign(new Error('deadline expired'), { code: 'failed_precondition' }) }
    const reply = { content: [{ type: 'text', text: big }] }
    const out = await syncHostActionOutputs('s1', [{ path: big, producer: 'recording', final: true }], reply, Date.now() + 15_000, node.deps)
    expect(node.deferred).toEqual(['recording/run.mp4'])
    expect(out.sync).toEqual({ deferred: ['/home/node/.superone/node/sync/s1/recording/run.mp4'] })
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

  it('hands a failed push to a job that continues the same transfer instead of failing the action', async () => {
    const node = fakeNode()
    const shot = desktopFile('s1', 'browser/shot.png', 'png')
    const put = node.deps.put
    node.deps.put = async (req) => { await put(req); throw Object.assign(new Error('node closed the socket'), { code: 'unavailable' }) }
    const reply = { content: [{ type: 'text', text: shot }] }
    const out = await syncHostActionOutputs('s1', [{ path: shot, producer: 'browser', final: true }], reply, Date.now() + 60_000, node.deps)
    expect(node.deferred).toEqual(['browser/shot.png'])
    expect(out.sync).toEqual({ deferred: ['/home/node/.superone/node/sync/s1/browser/shot.png'] })
    // The node may already hold the chunks the eager attempt sent; a job under
    // a fresh transferId would be told `busy` by that half-written transfer.
    expect(node.deferredJobs[0]?.transferId).toBe(node.puts[0]?.transferId)
  })

  it('tells the agent about deferred files inside the tool content, not only on the envelope', async () => {
    // `sync` is a SuperOne field on the reply envelope; the node's MCP server
    // forwards only `content`, so a deferred list that lives nowhere else is
    // invisible to the model.
    const node = fakeNode()
    const big = desktopFile('s1', 'recording/run.mp4', Buffer.alloc(64 * 1024))
    node.deps.transfers.throughputBytesPerMs = () => 1
    const reply = { content: [{ type: 'text', text: JSON.stringify({ ok: true, savedPath: big }) }] }
    const out = await syncHostActionOutputs('s1', [{ path: big, producer: 'recording', final: true }], reply, Date.now() + 15_000, node.deps)
    expect(out.content).toHaveLength(2)
    expect(out.content[1]?.text).toContain('/home/node/.superone/node/sync/s1/recording/run.mp4')
    expect(out.content[1]?.text).toMatch(/not (yet )?(there|available|synced)/i)
  })

  it('gives up on an upload that outruns the claim budget instead of waiting for the node', async () => {
    // Aborting the controller does not make a node RPC return. If the sync
    // step waits for it anyway, the claim is gone by the time the reply is
    // built — and the reply is what the agent gets.
    const node = fakeNode()
    const shot = desktopFile('s1', 'browser/shot.png', 'png')
    node.deps.put = () => new Promise(() => {})
    const reply = { content: [{ type: 'text', text: shot }] }
    const settled = await Promise.race([
      syncHostActionOutputs('s1', [{ path: shot, producer: 'browser', final: true }], reply, Date.now() + CLAIM_BUDGET_MARGIN_MS + 30, node.deps),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 500)),
    ])
    expect(settled).not.toBe('hung')
    expect(node.deferred).toEqual(['browser/shot.png'])
  })

  it('pushes a ref named in one block of a multi-block reply', async () => {
    // The mention check used to run on every block joined together, while the
    // rewrite ran per block. A JSON block plus a prose block is not JSON, so
    // the joined text parsed as neither and the ref was judged unmentioned —
    // never uploaded, and its path left pointing at the desktop.
    const node = fakeNode()
    // The quote is what makes it visible: JSON escapes it once per nesting
    // level, and the joined text was matched against a single level.
    const shot = desktopFile('s1', 'browser/a"b.png', 'png-bytes')
    const reply = {
      content: [
        { type: 'text', text: JSON.stringify({ result: JSON.stringify({ path: shot }) }) },
        { type: 'text', text: 'Image saved.' },
      ],
    }
    const out = await syncHostActionOutputs('s1', [{ path: shot, producer: 'browser', final: true }], reply, Date.now() + 60_000, node.deps)
    expect(node.files.has('browser/a"b.png')).toBe(true)
    expect(JSON.parse(JSON.parse(out.content![0].text!).result).path).toBe('/home/node/.superone/node/sync/s1/browser/a"b.png')
  })

  it('defers when the claim renewal itself hangs, instead of waiting past the claim it already had', async () => {
    // Asking for more time is another RPC that can stop answering. Waiting on
    // it under no deadline spends exactly the claim the renewal was meant to
    // protect.
    const node = fakeNode()
    const big = desktopFile('s1', 'recording/run.mp4', Buffer.alloc(64 * 1024))
    node.deps.transfers.throughputBytesPerMs = () => 10
    node.deps.renewClaim = () => new Promise(() => {})
    const reply = { content: [{ type: 'text', text: big }] }
    const settled = await Promise.race([
      syncHostActionOutputs('s1', [{ path: big, producer: 'recording', final: true }], reply, Date.now() + CLAIM_BUDGET_MARGIN_MS + 30, node.deps),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 500)),
    ])
    expect(settled).not.toBe('hung')
    expect(node.deferred).toEqual(['recording/run.mp4'])
  })

  it('pushes a file the reply names in Chinese prose, with Chinese punctuation around it', async () => {
    const node = fakeNode()
    const shot = desktopFile('s1', 'browser/shot.png', 'png-bytes')
    const reply = { content: [{ type: 'text', text: `截图已保存到 ${shot}，请查看。` }] }
    const out = await syncHostActionOutputs('s1', [{ path: shot, producer: 'browser', final: true }], reply, Date.now() + 60_000, node.deps)
    expect(node.files.has('browser/shot.png')).toBe(true)
    expect(out.content![0].text).toBe('截图已保存到 /home/node/.superone/node/sync/s1/browser/shot.png，请查看。')
  })

  it('rewrites without re-uploading a file the node already holds at the same size and mtime', async () => {
    // A download queued at capture time reaches the node before the agent
    // lists it; a recording listed twice is the same file twice. The stamp
    // the upload leaves — the node's mtime on the desktop copy — is how the
    // desktop can tell, the same way the mirror does.
    const node = fakeNode()
    const shot = desktopFile('s1', 'browser/shot.png', 'png-bytes')
    node.files.set('browser/shot.png', Buffer.from('png-bytes'))
    utimesSync(shot, 1_700_000_000, 1_700_000_000)
    const reply = { content: [{ type: 'text', text: shot }] }
    const out = await syncHostActionOutputs('s1', [{ path: shot, producer: 'browser', final: true }], reply, Date.now() + 60_000, node.deps)
    expect(node.puts).toHaveLength(0)
    expect(out.content![0].text).toBe('/home/node/.superone/node/sync/s1/browser/shot.png')
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
