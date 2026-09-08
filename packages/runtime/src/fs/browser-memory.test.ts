import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserMemoryStore } from './browser-memory'

const homes: string[] = []
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'browser-memory-'))
  homes.push(home)
  return { home, store: new BrowserMemoryStore(join(home, '.superone')) }
}
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })
const note = { domain: 'github.com', topic: 'issue-search', summary: 'Search issues', content: 'Wait for the results before reading them.' }

describe('personal browser memory', () => {
  it('persists markdown across store instances and isolates user homes and subdomains', async () => {
    const { home, store } = await fixture()
    expect(await store.read({ domain: note.domain })).toMatchObject({ count: 0, topics: [] })
    const saved = await store.write({ ...note, domain: 'https://GITHUB.COM./issues' })
    expect(await readFile(join(home, '.superone/browser/memory/github.com/issue-search.md'), 'utf8')).toContain(note.content)
    expect(await new BrowserMemoryStore(join(home, '.superone')).read(note)).toMatchObject({ ...note, revision: saved.revision })
    expect(await store.read({ domain: 'api.github.com' })).toMatchObject({ count: 0 })
    expect(await (await fixture()).store.read({ domain: note.domain })).toMatchObject({ count: 0 })
  })

  it('requires the current revision, serializes concurrent writers, and supports archive and restore', async () => {
    const { store, home } = await fixture()
    const saved = await store.write(note)
    await expect(store.write(note)).rejects.toThrow(/revision/i)
    const writers = [store, new BrowserMemoryStore(join(home, '.superone'))]
    const results = await Promise.allSettled(writers.map((s, i) => s.write({ ...note, content: `Change ${i}`, expectedRevision: saved.revision })))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const current = await store.read(note)
    if (!('revision' in current)) throw new Error('missing note')
    const archived = await store.write({ domain: note.domain, topic: note.topic, archived: true, expectedRevision: current.revision })
    expect(await store.read({ domain: note.domain })).toMatchObject({ count: 0 })
    expect(await store.read({ domain: note.domain, includeArchived: true })).toMatchObject({ count: 1 })
    await store.write({ domain: note.domain, topic: note.topic, archived: false, expectedRevision: archived.revision })
    expect(await store.read({ domain: note.domain })).toMatchObject({ count: 1 })
  })

  it('rejects traversal and symlink escapes without changing the target', async () => {
    const { store, home } = await fixture()
    await expect(store.write({ ...note, topic: '../escape' })).rejects.toThrow(/topic/i)
    await expect(store.write({ ...note, domain: '../escape' })).rejects.toThrow(/domain/i)
    const other = await fixture()
    await mkdir(join(home, '.superone/browser/memory'), { recursive: true })
    await symlink(other.home, join(home, '.superone/browser/memory/github.com'))
    await expect(store.write(note)).rejects.toThrow(/symbolic/i)
  })

  it('detects manual edits and does not overwrite malformed notes', async () => {
    const { store, home } = await fixture()
    const saved = await store.write(note)
    const path = join(home, '.superone/browser/memory/github.com/issue-search.md')
    await writeFile(path, (await readFile(path, 'utf8')) + '\nManual correction.')
    await expect(store.write({ ...note, expectedRevision: saved.revision })).rejects.toThrow(/revision/i)
    await writeFile(path, 'broken metadata')
    await expect(store.write(note)).rejects.toThrow(/metadata/i)
    expect(await readFile(path, 'utf8')).toBe('broken metadata')
    expect((await readdir(join(home, '.superone/browser/memory/github.com'))).filter(name => name.startsWith('.'))).toEqual([])
  })

  it('does not write on cancellation and clears old verification when content changes', async () => {
    const { store } = await fixture()
    const saved = await store.write({ ...note, verifiedAt: '2026-09-08T12:00:00Z' })
    const signal = AbortSignal.abort()
    await expect(store.write({ ...note, expectedRevision: saved.revision }, signal)).rejects.toThrow()
    expect(await store.read(note)).toMatchObject({ revision: saved.revision })
    await store.write({ ...note, content: 'Revised procedure', expectedRevision: saved.revision })
    expect(await store.read(note)).not.toHaveProperty('verifiedAt')
  })

  it('paginates summaries without putting topic bodies in the index', async () => {
    const { store } = await fixture()
    await Promise.all(Array.from({ length: 51 }, (_, i) => store.write({ ...note, topic: `topic-${String(i).padStart(2, '0')}` })))
    const first = await store.read({ domain: note.domain })
    expect(first).toMatchObject({ count: 51, nextOffset: 50 })
    if (!('topics' in first)) throw new Error('missing index')
    expect(first.topics).toHaveLength(50)
    expect(first.topics[0]).not.toHaveProperty('content')
    const next = await store.read({ domain: note.domain, offset: 50 })
    expect(next).toMatchObject({ topics: [{ topic: 'topic-50' }] })
    expect(next).not.toHaveProperty('nextOffset')
  })
})
