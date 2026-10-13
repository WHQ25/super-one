import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { startOwnedOpenCodeService } from './owned-service'
import { startOpenCodeServer } from './server'
import { discoverOpenCodeV2Resources } from './launch'
import { startOpenCodeModelProvider, nativeModelFixtureConfig } from './testing/native-model-provider'
import { OpenCodeV2Client } from './opencode-v2-client'

const binary = process.env.SUPERONE_OPENCODE_NATIVE_TEST_BINARY
describe('official owned native service', () => {
  it.skipIf(!binary)('imports a real native conversation without resuming its sibling during catalog discovery or migration', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'superone-native-import-')))
    const provider = await startOpenCodeModelProvider('original native reply')
    const env = { XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'),
      XDG_STATE_HOME: join(root, 'state'), SUPERONE_FIXTURE_KEY: 'fixture-only-key',
      OPENCODE_CONFIG_CONTENT: JSON.stringify(nativeModelFixtureConfig(provider.baseUrl)) }
    const handles: Array<{ close(): Promise<void> }> = []
    try {
      const original = await startOpenCodeServer({ binaryPath: binary, cwd: root, env }); handles.push(original)
      const source = new OpenCodeV2Client({ baseUrl: original.url, password: original.password, directory: root })
      const own = await source.createSession([]), sibling = await source.createSession([])
      await source.prompt(own.id, { text: 'original native input' })
      await vi.waitFor(async () => expect((await source.getSession(own.id)).outcome).toBe('succeeded'))
      await source.prompt(sibling.id, { text: 'unrelated sibling input' })
      await vi.waitFor(async () => expect((await source.getSession(sibling.id)).outcome).toBe('succeeded'))
      await original.close()
      const data = join(env.XDG_DATA_HOME, 'opencode')
      const sourcePath = join(data, readdirSync(data).find(name => /^opencode(?:-[\w.-]+)?\.db$/.test(name))!)
      const db = new Database(sourcePath)
      try { db.prepare('UPDATE session_v2 SET time_suspended = ? WHERE id = ?').run(12345, sibling.id) } finally { db.close() }
      expect((await discoverOpenCodeV2Resources(root, { binaryPath: binary, env }))?.agents.length).toBeGreaterThan(0)
      expect(provider.requests).toHaveLength(2)
      const imported = (await startOwnedOpenCodeService({ home: join(root, 'services'), sessionId: 'imported', nativeSessionId: own.id,
        binaryPath: binary, cwd: root, env }))!; handles.push(imported)
      const client = new OpenCodeV2Client({ baseUrl: imported.url, password: imported.password, directory: root })
      await expect(client.getSession(sibling.id)).rejects.toThrow()
      await client.prompt(own.id, { text: 'continue imported conversation' })
      await vi.waitFor(async () => expect((await client.getSession(own.id)).outcome).toBe('succeeded'))
      expect(provider.requests).toHaveLength(3)
      expect(JSON.stringify(provider.requests[2]?.body.messages)).toContain('original native input')
      expect(JSON.stringify(provider.requests[2]?.body.messages)).toContain('original native reply')
      expect(JSON.stringify(provider.requests[2]?.body.messages)).not.toContain('unrelated sibling input')
      const unchanged = new Database(sourcePath, { readonly: true })
      try { expect(unchanged.prepare('SELECT time_suspended FROM session_v2 WHERE id = ?').get(sibling.id)).toEqual({ time_suspended: 12345 }) }
      finally { unchanged.close() }
    } finally { await Promise.all(handles.map(handle => handle.close())); await provider.close(); rmSync(root, { recursive: true, force: true }) }
  }, 40_000)
  it.skipIf(!binary)('shares references for one session, isolates sibling credentials and releases only owned services', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'superone-owned-service-')))
    const env = { XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache') }
    const opts = { home: join(root, 'services'), sessionId: 'first', binaryPath: binary, cwd: root, env }
    const handles: Array<{ close(): Promise<void> }> = []
    try {
      const first = (await startOwnedOpenCodeService(opts))!; expect(first).toBeTruthy(); handles.push(first)
      const second = (await startOwnedOpenCodeService(opts))!; handles.push(second)
      const sibling = (await startOwnedOpenCodeService({ ...opts, sessionId: 'second' }))!; handles.push(sibling)
      expect(second.url).toBe(first.url); expect(second.password).toBe(first.password)
      expect(sibling.url === first.url).toBe(false); expect(sibling.password === first.password).toBe(false)
      expect((await fetch(`${first.url}/api/info`)).status).toBe(401)
      const client = new OpenCodeV2Client({ baseUrl: first.url, password: first.password, directory: root })
      expect((await client.resources()).agents.map(agent => agent.id)).toContain('build')
      await first.close()
      expect((await client.resources()).agents.map(agent => agent.id)).toContain('plan')
      await second.close()
      await expect(fetch(`${second.url}/api/info`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow()
      expect((await new OpenCodeV2Client({ baseUrl: sibling.url, password: sibling.password, directory: root }).resources()).agents.length).toBeGreaterThan(0)
    } finally { await Promise.all(handles.map(handle => handle.close())); rmSync(root, { recursive: true, force: true }) }
  }, 30_000)
})
