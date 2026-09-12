import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { InteractionMemoryStore } from './interaction-memory'

const homes: string[] = []
async function fixture(actor?: string) {
  const home = await mkdtemp(join(tmpdir(), 'okf-note-'))
  homes.push(home)
  const root = join(home, '.superone')
  return { root, store: new InteractionMemoryStore(root, actor) }
}
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })
const note = { domain: 'github.com', topic: 'issue-search', description: 'Search issues in a repository', content: '# Steps\n\nType in the search box.' }
function frontmatter(raw: string) { return parse(/^---\n([\s\S]*?)\n---\n/.exec(raw)![1]!) as Record<string, unknown> }

describe('OKF concept documents', () => {
  it('writes OKF frontmatter with provenance from the writing actor', async () => {
    const { store, root } = await fixture('superone-claude/claude-opus-5')
    const saved = await store.write('browser', { ...note, verified: true, sources: [{ id: 'docs', resource: 'https://docs.github.com/search', title: 'Search docs' }], staleAfter: '2027-01-01T00:00:00Z' })
    const raw = await readFile(join(root, 'browser/memory/github.com/issue-search.md'), 'utf8')
    const meta = frontmatter(raw)
    expect(meta).toMatchObject({ type: 'Playbook', title: 'issue-search', description: note.description, resource: 'https://github.com/', status: 'stable',
      generated: { by: 'superone-claude/claude-opus-5' }, verified: [{ by: 'superone-claude/claude-opus-5' }],
      sources: [{ id: 'docs', resource: 'https://docs.github.com/search', title: 'Search docs' }], stale_after: '2027-01-01T00:00:00Z' })
    expect(meta).not.toHaveProperty('version')
    expect(raw.endsWith(note.content)).toBe(true)
    expect(saved).toMatchObject({ saved: true, created: true, title: 'issue-search', status: 'stable', staleAfter: '2027-01-01T00:00:00Z' })
    expect(await store.read('browser', { domain: note.domain })).toMatchObject({ topics: [{ topic: note.topic, title: 'issue-search', description: note.description, status: 'stable', verifiedAt: saved.verified[0]!.at, generatedAt: saved.generated.at }] })
  })

  it('appends verification events, keeps them on metadata-only edits and preserves unknown keys', async () => {
    const { store, root } = await fixture('a/1')
    const first = await store.write('browser', { ...note, verified: true })
    const path = join(root, 'browser/memory/github.com/issue-search.md')
    await writeFile(path, (await readFile(path, 'utf8')).replace('---\n#', 'tags: [oncall]\n---\n#'))
    const current = await store.read('browser', note)
    if (!('revision' in current)) throw new Error('missing note')
    const second = await new InteractionMemoryStore(root, 'b/2').write('browser', { domain: note.domain, topic: note.topic, status: 'draft', verified: true, expectedRevision: current.revision })
    expect(second.verified.map(v => v.by)).toEqual(['a/1', 'b/2'])
    expect(second.generated).toEqual(first.generated)
    expect(frontmatter(await readFile(path, 'utf8'))).toMatchObject({ tags: ['oncall'], status: 'draft' })
  })

  it('reads legacy version 1 notes and migrates them to OKF on the next write', async () => {
    const { store, root } = await fixture()
    const dir = join(root, 'browser/memory/github.com')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'issue-search.md'), '---\nversion: 1\nsummary: Legacy summary\nupdatedAt: 2026-09-01T00:00:00.000Z\narchived: true\nsource: https://example.com/ref\nverifiedAt: 2026-09-02T00:00:00.000Z\n---\nLegacy body')
    const legacy = await store.read('browser', note)
    expect(legacy).toMatchObject({ description: 'Legacy summary', status: 'deprecated', content: 'Legacy body', generated: { by: 'superone/agent', at: '2026-09-01T00:00:00.000Z' },
      verified: [{ by: 'superone/agent', at: '2026-09-02T00:00:00.000Z' }], sources: [{ resource: 'https://example.com/ref' }] })
    if (!('revision' in legacy)) throw new Error('missing note')
    await store.write('browser', { domain: note.domain, topic: note.topic, status: 'stable', expectedRevision: legacy.revision })
    const meta = frontmatter(await readFile(join(dir, 'issue-search.md'), 'utf8'))
    expect(meta).toMatchObject({ type: 'Playbook', description: 'Legacy summary', status: 'stable', sources: [{ resource: 'https://example.com/ref' }] })
    expect(meta).not.toHaveProperty('summary')
  })

  it('maintains OKF index.md at the target and bundle root, and reserves index/log topic names', async () => {
    const { store, root } = await fixture()
    await store.write('browser', note)
    await store.write('browser', { ...note, domain: 'example.com', topic: 'login', description: 'Sign in' })
    await store.write('computer', { platform: 'macos', appId: 'com.apple.TextEdit', topic: 'find-text', description: 'Find text', content: 'Use Edit > Find.' })
    const target = await readFile(join(root, 'browser/memory/github.com/index.md'), 'utf8')
    expect(target).toContain('* [issue-search](issue-search.md) - Search issues in a repository')
    const bundle = await readFile(join(root, 'browser/memory/index.md'), 'utf8')
    expect(bundle).toContain('okf_version: "0.2"')
    expect(bundle).toContain('* [example.com](example.com/)')
    expect(bundle).toContain('* [github.com](github.com/)')
    expect(await readFile(join(root, 'computer/memory/index.md'), 'utf8')).toContain('* [macos/com.apple.TextEdit](macos/com.apple.TextEdit/)')
    expect(await store.read('browser', { domain: note.domain })).toMatchObject({ count: 1 })
    for (const topic of ['index', 'log']) await expect(store.write('browser', { ...note, topic })).rejects.toThrow(/reserved/)
    const saved = await store.read('browser', note)
    if (!('revision' in saved)) throw new Error('missing note')
    await store.write('browser', { domain: note.domain, topic: note.topic, status: 'deprecated', expectedRevision: saved.revision })
    expect(await readFile(join(root, 'browser/memory/github.com/index.md'), 'utf8')).toMatch(/# Deprecated\n\n\* \[issue-search\]/)
  })

  it('rejects malformed OKF metadata and invalid write fields', async () => {
    const { store, root } = await fixture()
    const dir = join(root, 'browser/memory/github.com')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'issue-search.md'), '---\ntype: Playbook\ndescription: ok\nverified: { by: x }\n---\nbody')
    await expect(store.read('browser', note)).rejects.toThrow(/verified/)
    await expect(store.write('browser', { ...note, topic: 'other', status: 'archived' as never })).rejects.toThrow(/status/)
    await expect(store.write('browser', { ...note, topic: 'other', staleAfter: 'soon' })).rejects.toThrow(/staleAfter/)
    await expect(store.write('browser', { ...note, topic: 'other', sources: [{ id: 'Bad Id', resource: 'x' }] })).rejects.toThrow(/sources/)
  })
})
