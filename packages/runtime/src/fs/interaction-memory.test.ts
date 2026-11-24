import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InteractionMemoryStore, executeInteractionMemoryTool } from './interaction-memory'

const homes: string[] = []
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'interaction-memory-'))
  homes.push(home)
  return { home, store: new InteractionMemoryStore(join(home, '.superone')) }
}
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })
const note = { appId: 'com.example.app', platform: 'macos', topic: 'search', description: 'Search for a document', content: 'Use the search field, then wait for the result list.' }

describe('computer and device experience', () => {
  it('shares persistence and revision checks while isolating platform, app, family and node', async () => {
    const { store, home } = await fixture()
    const saved = await store.write('computer', note)
    expect(await readFile(join(home, '.superone/computer/memory/macos/com.example.app/search.md'), 'utf8')).toContain(note.content)
    expect(await new InteractionMemoryStore(join(home, '.superone')).read('computer', note)).toMatchObject({ platform: 'macos', appId: note.appId, revision: saved.revision })
    for (const target of [{ ...note, appId: 'com.example.other' }, { ...note, platform: 'windows' }]) {
      expect(await store.read('computer', { ...target, topic: undefined })).toMatchObject({ count: 0 })
    }
    const phone = { ...note, platform: 'ios' }
    expect(await store.read('device', { ...phone, topic: undefined })).toMatchObject({ count: 0 })
    const deviceNote = await store.write('device', phone)
    expect(await readFile(join(home, '.superone/device/memory/ios/com.example.app/search.md'), 'utf8')).toContain(note.content)
    expect(await store.read('device', { ...phone, platform: 'android', topic: undefined })).toMatchObject({ count: 0 })
    expect(await (await fixture()).store.read('device', { ...phone, topic: undefined })).toMatchObject({ count: 0 })
    await expect(store.write('device', { ...phone, expectedRevision: 'stale', content: 'Stale edit' })).rejects.toThrow(/revision/i)
    await store.write('device', { ...phone, status: 'deprecated', expectedRevision: deviceNote.revision })
    expect(await store.read('device', { ...phone, topic: undefined })).toMatchObject({ count: 0 })
    expect(await store.read('computer', note)).toMatchObject({ status: 'stable' })
  })

  it('rejects host-platform inference, transient identifiers and unsafe paths without executing UI actions', async () => {
    const { store } = await fixture()
    for (const args of [{ ...note, platform: undefined }, { ...note, platform: 'ios' }, { ...note, appId: '../escape' }, { ...note, appId: '@r1' }, { ...note, appId: '12345' }]) {
      const result = await executeInteractionMemoryTool('computer_memory_write', args, store)
      expect(result.isError).toBe(true)
    }
    expect((await executeInteractionMemoryTool('device_memory_write', { ...note, platform: 'android', appId: 'system' }, store)).isError).toBeUndefined()
    expect((await executeInteractionMemoryTool('device_act', {}, store)).isError).toBe(true)
  })

  it('isolates project-scoped memories while merging global fallback and summarizing for entry tools', async () => {
    const { home, store } = await fixture()
    const projA = store.withContext({ projectPath: join(home, 'repo-a') })
    const projB = store.withContext({ projectPath: join(home, 'repo-b') })

    await store.write('browser', { domain: 'github.com', topic: 'pr-flow', description: 'Global PR checklist', content: 'Global steps.' })
    await projA.write('browser', { domain: 'github.com', topic: 'deploy-check', description: 'Repo A deploy gate', content: 'Repo A steps.' })
    await projB.write('browser', { domain: 'github.com', topic: 'lint-check', description: 'Repo B lint gate', content: 'Repo B steps.' })

    const idxA = await projA.read('browser', { domain: 'github.com' }) as { topics: Array<{ topic: string; scope: string }> }
    expect(idxA.topics.map(t => [t.topic, t.scope])).toEqual([
      ['deploy-check', 'project'],
      ['pr-flow', 'global'],
    ])
    const idxB = await projB.read('browser', { domain: 'github.com' }) as { topics: Array<{ topic: string; scope: string }> }
    expect(idxB.topics.map(t => [t.topic, t.scope])).toEqual([
      ['lint-check', 'project'],
      ['pr-flow', 'global'],
    ])

    await projA.write('device', { platform: 'ios', appId: 'com.acme.mobile', topic: 'login', description: 'Test account flow', content: 'Tap SSO.' })
    await store.write('device', { platform: 'ios', appId: 'system', topic: 'keyboard', description: 'Dismiss simulator keyboard', content: 'Cmd+K.' })

    const deviceSummary = await projA.summarizeForEntry('device', { platform: 'ios' })
    expect(deviceSummary).toEqual([
      { topic: 'login', description: 'Test account flow', scope: 'project', appId: 'com.acme.mobile' },
      { topic: 'keyboard', description: 'Dismiss simulator keyboard', scope: 'global', appId: 'system' },
    ])
    const deviceSummaryB = await projB.summarizeForEntry('device', { platform: 'ios' })
    expect(deviceSummaryB).toEqual([
      { topic: 'keyboard', description: 'Dismiss simulator keyboard', scope: 'global', appId: 'system' },
    ])
  })
})
