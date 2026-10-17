import { describe, expect, it, vi } from 'vitest'
import type { PermissionRequest, SessionAgentLaunchConfig } from '@superone/shared/agent-types'
import { fakeHost, fakeSession } from './collaboration-test-fixtures'
import { getSessionCollaborationRunConfig, listSessionAgentProfiles, requestSessionAgents, startSessionAgent } from './session-collaboration'
import { resolveSessionAgentsConfirm } from './session-collaboration-confirm'
import type { SessionProvider } from './types'

const parsed = (result: { content: Array<{ text: string }> }) => JSON.parse(result.content[0].text)

export function registerDefaultProfileScenarios(fixture: {
  setEnabled(enabled: boolean): void
  providers(): SessionProvider[]
  setDefaults(config: Partial<SessionAgentLaunchConfig>): void
  setAcpAgent(id: string): void
  useReadOnlyCodex(): void
  duringProjectResolution(effect: () => void): void
  grantCount(): number
}) {
  const proposal = (config?: SessionAgentLaunchConfig) => ({ launches: [{ agentId: 'claude-base', name: 'Worker', role: 'Implementer', summary: 'Implement the task', config }] })

  describe('dynamic default Profiles', () => {
    it('requires review for built-in agents and hides saved Profiles while disabled', async () => {
      fixture.providers().push({ id: 'saved-worker', harnessId: 'claude', name: 'Saved Worker', isBase: false, config: { profile: { version: 1, identity: { name: 'Saved Worker', description: 'Build' } } }, createdAt: 0, updatedAt: 0 })
      fixture.setEnabled(false)
      expect(listSessionAgentProfiles().map((profile) => profile.id)).toContain('claude-base')
      expect(listSessionAgentProfiles().map((profile) => profile.id)).not.toContain('saved-worker')
      const parent = fakeSession('parent')
      const { host } = fakeHost(parent)
      const pending = requestSessionAgents(parent.id, proposal(), host)
      const request = (vi.mocked(parent.emitHostEvent).mock.calls[0][0] as { request: PermissionRequest }).request
      resolveSessionAgentsConfirm(request.requestId, 'decline')
      expect(parsed(await pending).status).toBe('rejected')
      expect(fixture.grantCount()).toBe(0)
    })

    it.each(['before start', 'during project resolution'])('revokes unused default approval when disabled %s', async (when) => {
      const parent = fakeSession('parent')
      const { host, createSession } = fakeHost(parent)
      const requested = parsed(await requestSessionAgents(parent.id, proposal(), host))
      const disable = () => fixture.setEnabled(false)
      if (when === 'before start') disable()
      else fixture.duringProjectResolution(disable)
      const run = startSessionAgent(parent.id, { launchId: requested.launches[0].launchId, task: 'Build it' }, host)
      if (when === 'before start') expect(parsed(await run).status).toBe('error')
      else await expect(run).rejects.toThrow(/Profile approval/)
      expect(createSession).not.toHaveBeenCalled()
    })

    it.each(['claude', 'codex', 'acp', 'opencode', 'cursor', 'dsh'] as const)('provides one dynamic default Profile for %s', async (harnessId) => {
      fixture.providers().splice(0, fixture.providers().length, { id: `${harnessId}-base`, harnessId, name: harnessId, isBase: true, config: harnessId === 'acp' ? { agentId: 'grok-build' } : {}, createdAt: 0, updatedAt: 0 })
      const profiles = listSessionAgentProfiles()
      expect(profiles).toHaveLength(1)
      expect(profiles[0].followsDefaults).toBe(true)
      const parent = fakeSession('parent')
      const { host } = fakeHost(parent)
      const requested = parsed(await requestSessionAgents(parent.id, { launches: [{ ...proposal().launches[0], agentId: profiles[0].id }] }, host))
      expect(requested.status).toBe('approved')
      expect(parent.emitHostEvent).not.toHaveBeenCalled()
    })

    it.each(['spawn', 'handoff'] as const)('starts the built-in %s without confirmation or a saved approval', async (mode) => {
      const parent = fakeSession('parent')
      const { host, createSession } = fakeHost(parent)
      const requested = parsed(await requestSessionAgents(parent.id, { launches: [{ ...proposal().launches[0], mode }] }, host))
      expect(parent.emitHostEvent).not.toHaveBeenCalled()
      const started = parsed(await startSessionAgent(parent.id, { launchId: requested.launches[0].launchId, task: 'Build it' }, host))
      expect(started.status).toBe('started')
      expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'claude-base', model: 'test-model', effort: 'high' }))
    })

    it('reads changed defaults from the same built-in row', () => {
      expect(listSessionAgentProfiles()[0].defaultConfig).toMatchObject({ model: 'test-model', effort: 'high' })
      fixture.setDefaults({ model: 'alternate-model', effort: 'low', permissionMode: 'bypassPermissions', sandboxMode: 'on', apiProviderId: 'api-1' })
      expect(listSessionAgentProfiles()[0]).toMatchObject({ id: 'claude-base', followsDefaults: true, defaultConfig: { model: 'alternate-model', effort: 'low', permissionMode: 'bypassPermissions', sandboxMode: 'on', apiProviderId: 'api-1' } })
      expect(fixture.providers()).toHaveLength(1)
    })

    it.each(['before start', 'during project preparation'])('starts with the latest defaults when they change %s', async (when) => {
      const parent = fakeSession('parent')
      const { host, createSession } = fakeHost(parent)
      const requested = parsed(await requestSessionAgents(parent.id, proposal(), host))
      const change = () => fixture.setDefaults({ model: 'alternate-model', effort: 'low', apiProviderId: 'api-1' })
      if (when === 'before start') change()
      else fixture.duringProjectResolution(change)
      const started = parsed(await startSessionAgent(parent.id, { launchId: requested.launches[0].launchId, task: 'Build it' }, host))
      expect(started.status).toBe('started')
      expect(parent.emitHostEvent).not.toHaveBeenCalled()
      expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'alternate-model', effort: 'low', apiProviderId: 'api-1' }))
    })

    it('ignores old runtime snapshots on built-in rows', () => {
      fixture.providers()[0].config = { model: 'alternate-model', effort: 'low' }
      expect(listSessionAgentProfiles()[0].defaultConfig).toMatchObject({ model: 'test-model', effort: 'high' })
    })

    it('keeps started children on their initial settings when defaults change', async () => {
      const parent = fakeSession('parent')
      const { host, createSession } = fakeHost(parent)
      const requested = parsed(await requestSessionAgents(parent.id, proposal(), host))
      const input = { launchId: requested.launches[0].launchId, task: 'Build it' }
      const started = parsed(await startSessionAgent(parent.id, input, host))
      fixture.setDefaults({ model: 'alternate-model', effort: 'low' })
      expect(parsed(await startSessionAgent(parent.id, input, host))).toMatchObject({ sessionId: started.sessionId, reused: true })
      expect(createSession).toHaveBeenCalledTimes(1)
      expect(host.getSession(started.sessionId)!.send).toHaveBeenCalledTimes(1)
    })

    it('does not issue default grants when the user rejects an override in the same batch', async () => {
      const parent = fakeSession('parent')
      const { host } = fakeHost(parent)
      const pending = requestSessionAgents(parent.id, { launches: [...proposal().launches, ...proposal({ effort: 'low' }).launches] }, host)
      const request = (vi.mocked(parent.emitHostEvent).mock.calls[0][0] as { request: PermissionRequest }).request
      expect(request.sessionAgentsConfirm!.launches).toHaveLength(1)
      resolveSessionAgentsConfirm(request.requestId, 'decline')
      expect(parsed(await pending).status).toBe('rejected')
      expect(fixture.grantCount()).toBe(0)
    })

    it('follows the ACP selection instead of the seeded base agent id', () => {
      fixture.providers().splice(0, 1, { id: 'acp-base', harnessId: 'acp', name: 'ACP', isBase: true, config: { agentId: 'grok-build' }, createdAt: 0, updatedAt: 0 })
      fixture.setAcpAgent('agent-selected')
      expect(listSessionAgentProfiles()[0].acpAgentId).toBe('agent-selected')
    })

    it('preserves the native read-only Codex default through launch and restore settings', async () => {
      fixture.useReadOnlyCodex()
      const parent = fakeSession('parent')
      const { host, createSession } = fakeHost(parent)
      const requested = parsed(await requestSessionAgents(parent.id, { launches: [{ ...proposal().launches[0], agentId: 'codex-base' }] }, host))
      const started = parsed(await startSessionAgent(parent.id, { launchId: requested.launches[0].launchId, task: 'Read it' }, host))
      expect(parent.emitHostEvent).not.toHaveBeenCalled()
      expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ codexPermissionPreset: 'read-only' }))
      expect(getSessionCollaborationRunConfig(started.sessionId)?.codexPermissionPreset).toBe('read-only')
      expect(host.getSession(started.sessionId)!.send).toHaveBeenCalledWith(expect.objectContaining({ codex: { permissionPreset: 'read-only' } }))
    })

    it('requires review for a shared permission override of native read-only Codex defaults', async () => {
      fixture.useReadOnlyCodex()
      const parent = fakeSession('parent')
      const { host } = fakeHost(parent)
      const pending = requestSessionAgents(parent.id, { launches: [{ ...proposal({ permissionMode: 'bypassPermissions' }).launches[0], agentId: 'codex-base' }] }, host)
      const request = (vi.mocked(parent.emitHostEvent).mock.calls[0][0] as { request: PermissionRequest }).request
      expect(request.sessionAgentsConfirm!.launches[0].config.codexPermissionPreset).toBe('full-access')
      resolveSessionAgentsConfirm(request.requestId, 'decline')
      expect(parsed(await pending).status).toBe('rejected')
    })

    it('still asks for an override outside the current defaults', async () => {
      const parent = fakeSession('parent')
      const { host } = fakeHost(parent)
      const pending = requestSessionAgents(parent.id, proposal({ effort: 'low' }), host)
      const request = (vi.mocked(parent.emitHostEvent).mock.calls[0][0] as { request: PermissionRequest }).request
      expect(request.requestKind).toBe('session_agents_confirm')
      resolveSessionAgentsConfirm(request.requestId, 'decline')
      expect(parsed(await pending).status).toBe('rejected')
    })
  })
}
