import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { NodeSessionRecord } from '@superone/runtime/session'
import { createManagedOpenCodeTurnRunner } from './managed-runner'
import { nativeModelFixtureConfig, startOpenCodeModelProvider } from './testing/native-model-provider'
import { startNativeScopeProvider } from './testing/native-scope-provider'

const binary = process.env.SUPERONE_OPENCODE_NATIVE_TEST_BINARY
describe('native host MCP credential isolation', () => {
  it.skipIf(!binary)('keeps two same-directory sessions on their own tool surface, credentials and native metadata', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'superone-native-scopes-')))
    const model = await startOpenCodeModelProvider(), mcp = await startNativeScopeProvider()
    const env = { XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_STATE_HOME: join(root, 'state'),
      XDG_CACHE_HOME: join(root, 'cache'), SUPERONE_FIXTURE_KEY: 'fixture-only-key' }
    writeFileSync(join(root, 'opencode.json'), JSON.stringify(nativeModelFixtureConfig(model.baseUrl)))
    const runner = createManagedOpenCodeTurnRunner(() => root, { binaryPath: binary, env, serviceHome: join(root, 'services'),
      getSuperoneMcp: id => ({ url: mcp.url, headers: { authorization: `Bearer scope_${id}` } }) })
    const session = (id: string): NodeSessionRecord => ({ sessionId: id, projectId: 'p', harnessId: 'opencode', providerId: 'opencode', title: null,
      status: 'streaming', transcript: [], pendingInteraction: null, providerResume: null, cwd: root, createdAt: 0, updatedAt: 0,
      isPinned: false, isHidden: false, isUserRenamed: false, controllerClientSessionId: null, hostActionCapabilityVersion: 0, hostActionToolGroups: [], alwaysAllowedTools: [] })
    const resume = new Map<string, string>()
    const turns: Promise<unknown>[] = []
    const start = (id: string) => { const turn = runner({ session: session(id), text: `scope ${id}`, onDelta: () => {},
      onPermission: async () => 'allow', onProviderResume: value => resume.set(id, value), signal: new AbortController().signal });
      void turn.catch(() => {}); turns.push(turn); return turn }
    try {
      start('a'); await vi.waitFor(() => expect(model.requests).toHaveLength(1), { timeout: 10_000 })
      start('b'); await vi.waitFor(() => expect(model.requests.length).toBeGreaterThanOrEqual(2), { timeout: 10_000 })
      const names = (index: number) => (model.requests[index]!.body.tools as Array<{ function: { name: string } }>).map(tool => tool.function.name)
      expect(names(0)).toContain('superone_scope_a'); expect(names(0)).not.toContain('superone_scope_b')
      expect(names(1)).toContain('superone_scope_b'); expect(names(1)).not.toContain('superone_scope_a')
      model.callTool('superone_scope_a')
      await vi.waitFor(() => expect(mcp.calls).toHaveLength(1))
      model.callTool('superone_scope_b')
      await vi.waitFor(() => expect(mcp.calls).toHaveLength(2))
      await vi.waitFor(() => expect(model.requests).toHaveLength(4))
      model.finish('scope a reply'); model.finish('scope b reply')
      await Promise.all(turns)
      expect(mcp.calls).toEqual([{ scope: 'scope_a', nativeSessionId: resume.get('a')!.slice(9) }, { scope: 'scope_b', nativeSessionId: resume.get('b')!.slice(9) }])
      expect(readFileSync(join(root, 'opencode.json'), 'utf8').includes('Bearer scope_')).toBe(false)
    } finally { await runner.disposeAll!(); await model.close(); await mcp.close(); rmSync(root, { recursive: true, force: true }) }
  }, 35_000)
})
