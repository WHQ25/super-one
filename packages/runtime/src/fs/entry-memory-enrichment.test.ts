import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InteractionMemoryStore } from './interaction-memory'
import { EntryMemoryTracker, enrichEntryReplyWithMemory } from './entry-memory-enrichment'

const homes: string[] = []
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'entry-memory-'))
  homes.push(home)
  return { home, store: new InteractionMemoryStore(join(home, '.superone')) }
}
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })

describe('entry memory enrichment', () => {
  it('injects memorySummary on entry tools once per session and skips snapshot/empty targets', async () => {
    const { home, store } = await fixture()
    const projectPath = join(home, 'my-mobile-app')
    const projStore = store.withContext({ projectPath })
    await projStore.write('browser', {
      domain: 'localhost',
      topic: 'dev-login',
      description: 'Use test seed account on localhost',
      content: 'Click dev-login.',
    })
    await projStore.write('computer', {
      platform: 'macos',
      appId: 'com.apple.dt.Xcode',
      topic: 'scheme',
      description: 'Select Staging scheme before run',
      content: 'Use Staging.',
    })
    await projStore.write('device', {
      platform: 'ios',
      appId: 'com.example.mobile',
      topic: 'onboarding',
      description: 'Skip first-run modal',
      content: 'Tap Skip.',
    })

    const tracker = new EntryMemoryTracker()

    const tabReply = await enrichEntryReplyWithMemory(
      { content: [{ type: 'text', text: JSON.stringify({ url: 'http://localhost:3000/dashboard', ok: true }) }] },
      { sessionId: 's1', toolName: 'browser_tabs', args: { action: 'open', url: 'http://localhost:3000' }, store, projectPath },
      tracker,
    )
    const tabJson = JSON.parse(tabReply.content[0]!.text!)
    expect(tabJson.memorySummary.target).toBe('localhost')
    expect(tabJson.memorySummary.topics).toEqual([
      { topic: 'dev-login', description: 'Use test seed account on localhost', scope: 'project' },
    ])

    const tabSecond = await enrichEntryReplyWithMemory(
      { content: [{ type: 'text', text: JSON.stringify({ url: 'http://localhost:3000/settings', ok: true }) }] },
      { sessionId: 's1', toolName: 'browser_tabs', args: { action: 'navigate', url: 'http://localhost:3000/settings' }, store, projectPath },
      tracker,
    )
    expect(JSON.parse(tabSecond.content[0]!.text!).memorySummary).toBeUndefined()

    const snapshotReply = await enrichEntryReplyWithMemory(
      { content: [{ type: 'text', text: JSON.stringify({ url: 'http://localhost:3000/dashboard' }) }] },
      { sessionId: 's1', toolName: 'browser_snapshot', args: {}, store, projectPath },
      tracker,
    )
    expect(JSON.parse(snapshotReply.content[0]!.text!).memorySummary).toBeUndefined()

    const emptyDomain = await enrichEntryReplyWithMemory(
      { content: [{ type: 'text', text: JSON.stringify({ url: 'https://example.org', ok: true }) }] },
      { sessionId: 's1', toolName: 'browser_tabs', args: { action: 'open', url: 'https://example.org' }, store, projectPath },
      tracker,
    )
    expect(JSON.parse(emptyDomain.content[0]!.text!).memorySummary).toBeUndefined()

    const appToonReply = await enrichEntryReplyWithMemory(
      { content: [{ type: 'text', text: 'action: launch\nbundleId: com.apple.dt.Xcode\nok: true' }] },
      { sessionId: 's1', toolName: 'computer_apps', args: { action: 'launch', app: 'Xcode' }, store, projectPath, fallbackPlatform: 'macos' },
      tracker,
    )
    expect(appToonReply.content[0]!.text).toContain('memorySummary:')
    expect(appToonReply.content[0]!.text).toContain('com.apple.dt.Xcode')

    const deviceBoot = await enrichEntryReplyWithMemory(
      { content: [{ type: 'text', text: JSON.stringify({ device: { id: 'sim-1', platform: 'ios' }, booted: true }) }] },
      { sessionId: 's1', toolName: 'device_boot', args: { device: 'sim-1' }, store, projectPath },
      tracker,
    )
    const deviceJson = JSON.parse(deviceBoot.content[0]!.text!)
    expect(deviceJson.memorySummary.topics).toEqual([
      { topic: 'onboarding', description: 'Skip first-run modal', scope: 'project', appId: 'com.example.mobile' },
    ])
  })
})
