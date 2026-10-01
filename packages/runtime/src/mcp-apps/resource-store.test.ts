import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMcpAppResourceStore } from './resource-store'
const directories: string[] = []
const setup = () => { const dir = mkdtempSync(join(tmpdir(), 'mcp-resource-store-')); directories.push(dir); return { dir, store: createMcpAppResourceStore(dir) } }
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('content-addressed View history', () => {
  it('writes one atomic blob for identical HTML and persists only the hash and per-View metadata', () => {
    const { dir, store } = setup()
    const a = store.put({ html: '<html>one</html>', hash: 'untrusted', meta: { prefersBorder: true } })
    const b = store.put({ html: '<html>one</html>', hash: 'other', meta: {} })
    expect(a.hash).toMatch(/^[a-f0-9]{64}$/); expect(a.hash).toBe(b.hash)
    expect(a).not.toHaveProperty('html'); expect(readdirSync(dir)).toEqual([`${a.hash}.html`])
    expect(readFileSync(join(dir, `${a.hash}.html`), 'utf8')).toBe('<html>one</html>')
    expect(createMcpAppResourceStore(dir).hydrate(a)).toEqual({ ...a, html: '<html>one</html>' })
    expect(store.hydrate(b).meta).toEqual({})
  })
  it('never derives a path from client text and refuses corrupted/missing blobs', () => {
    const { dir, store } = setup()
    for (const hash of ['../../secret', 'A'.repeat(64), 'a'.repeat(63)]) expect(() => store.hydrate({ hash, meta: {} })).toThrow()
    const reference = store.put({ html: 'original', hash: 'unused', meta: {} })
    writeFileSync(join(dir, `${reference.hash}.html`), 'tampered')
    expect(() => createMcpAppResourceStore(dir).hydrate(reference)).toThrow('hash')
    store.put({ ...reference, html: 'original' })
    expect(createMcpAppResourceStore(dir).hydrate(reference).html).toBe('original')
    rmSync(join(dir, `${reference.hash}.html`))
    expect(() => createMcpAppResourceStore(dir).hydrate(reference)).toThrow('unavailable')
  })
  it('keeps legacy inline snapshots readable without a path or migration', () => {
    const { store } = setup()
    expect(store.hydrate({ hash: 'legacy', meta: {}, html: 'saved legacy' }).html).toBe('saved legacy')
  })
  it('collects only unreferenced old blobs and retains shared references plus in-flight write grace', () => {
    const { dir, store } = setup()
    const unique = store.put({ html: 'unique', hash: 'x', meta: {} }), shared = store.put({ html: 'shared', hash: 'x', meta: {} })
    expect(store.collect([], 300_000)).toBe(0)
    const old = new Date(Date.now() - 600_000)
    for (const hash of [unique.hash, shared.hash]) utimesSync(join(dir, `${hash}.html`), old, old)
    expect(store.collect([shared.hash], 300_000)).toBe(1)
    expect(readdirSync(dir)).toEqual([`${shared.hash}.html`])
    expect(store.collect([], 300_000)).toBe(1)
  })
})
