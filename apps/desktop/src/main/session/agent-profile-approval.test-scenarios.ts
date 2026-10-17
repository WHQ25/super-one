/** Scenarios share the real collaboration integration harness, not a second launcher mock. */
import type Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import type { PermissionRequest } from '@superone/shared/agent-types'
import type { SessionCreateOptions, SessionProvider } from './types'
import { approveAgentProfile, isAgentProfileApproved, selectedApprovalProvider } from './agent-profile-approval'
import { listSessionAgentProfiles, requestSessionAgents, startSessionAgent } from './session-collaboration'
import { fakeHost, fakeSession } from './collaboration-test-fixtures'
import { resolveSessionAgentsConfirm } from './session-collaboration-confirm'

const parsed = (value: { content: Array<{ text: string }> }) => JSON.parse(value.content[0].text)

export function registerProfileApprovalScenarios(fixture: {
  db: () => Database.Database
  providers: () => SessionProvider[]
  duringProjectResolution: (effect: () => void) => void
  setAcpAgent: (id: string | null, source: 'preference' | 'cache') => void
}) {
  function seed(approved = true) {
    const db = fixture.db()
    db.exec('CREATE TABLE IF NOT EXISTS session_providers (id TEXT PRIMARY KEY)')
    for (const id of ['implementer']) {
      const row: SessionProvider = { id, name: id, harnessId: 'claude', isBase: false, createdAt: 0, updatedAt: 0,
        config: { profile: { version: 1, identity: { name: id, description: `Role: ${id}` }, instructions: `Act as ${id}.`, runtime: { model: 'test-model', effort: 'high' } } } }
      fixture.providers().push(row)
      db.prepare('INSERT INTO session_providers (id) VALUES (?)').run(id)
      if (approved) approveAgentProfile(row, listSessionAgentProfiles().find((p) => p.id === id)!.defaultConfig)
    }
  }
  function environment() { const parent = fakeSession('parent'); return { parent, ...fakeHost(parent) } }
  function proposal(id = 'implementer', config?: Record<string, unknown>) { return { launches: [{ agentId: id, name: id, role: 'Worker', summary: 'Implement a task', config }] } }
  function permission(parent: ReturnType<typeof fakeSession>): PermissionRequest {
    return (parent.emitHostEvent as ReturnType<typeof vi.fn>).mock.calls.find(([e]) => e.type === 'permission_request')![0].request
  }

  describe('saved Profile preapproval lifecycle', () => {
    it('keeps legacy saved Profiles unapproved until a user reviews them', async () => {
      seed(false)
      const { parent, host } = environment()
      const pending = requestSessionAgents(parent.id, proposal(), host)
      expect(permission(parent).requestKind).toBe('session_agents_confirm')
      resolveSessionAgentsConfirm(permission(parent).requestId, 'decline')
      expect(parsed(await pending).status).toBe('rejected')
      expect(fixture.db().prepare('SELECT COUNT(*) AS count FROM session_collaboration_grants').get()).toEqual({ count: 0 })
    })
    it('reuses durable approval, starts on demand, and retries without duplicate work', async () => {
      seed()
      const { parent, host, createSession } = environment()
      const approved = parsed(await requestSessionAgents(parent.id, proposal(), host)).launches[0]
      expect((parent.emitHostEvent as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
      expect(createSession).not.toHaveBeenCalled()
      const first = parsed(await startSessionAgent(parent.id, { launchId: approved.launchId, task: 'Build it' }, host))
      const retry = parsed(await startSessionAgent(parent.id, { launchId: approved.launchId, task: 'Different brief' }, host))
      expect(retry.sessionId).toBe(first.sessionId)
      expect(createSession).toHaveBeenCalledTimes(1)
      expect(host.getSession(first.sessionId)!.send).toHaveBeenCalledTimes(1)
    })
    it('shares simultaneous retries of a preapproved launch', async () => {
      seed()
      const { parent, host, createSession } = environment()
      const approved = parsed(await requestSessionAgents(parent.id, proposal(), host)).launches[0]
      const [one, two] = await Promise.all([
        startSessionAgent(parent.id, { launchId: approved.launchId, task: 'First brief' }, host),
        startSessionAgent(parent.id, { launchId: ` ${approved.launchId} `, task: 'Retry brief' }, host),
      ])
      expect(parsed(one).sessionId).toBe(parsed(two).sessionId)
      expect(createSession).toHaveBeenCalledTimes(1)
    })
    it('retries an undelivered handoff brief without creating a second session', async () => {
      seed()
      const { parent, host, createSession, sessions } = environment()
      createSession.mockImplementationOnce((options: SessionCreateOptions) => {
        const child = fakeSession(options.id!)
        vi.mocked(child.send).mockRejectedValueOnce(new Error('Temporary send failure'))
        sessions.set(child.id, child)
        return child
      })
      const launch = parsed(await requestSessionAgents(parent.id, { launches: [{ ...proposal().launches[0], mode: 'handoff' }] }, host)).launches[0]
      await expect(startSessionAgent(parent.id, { launchId: launch.launchId, task: 'Original brief' }, host)).rejects.toThrow('Temporary send failure')
      const retried = parsed(await startSessionAgent(parent.id, { launchId: launch.launchId, task: 'Replacement brief' }, host))
      expect(retried).toMatchObject({ status: 'started', reused: true })
      expect(createSession).toHaveBeenCalledTimes(1)
      const send = host.getSession(retried.sessionId)!.send as ReturnType<typeof vi.fn>
      expect(send).toHaveBeenCalledTimes(2)
      expect(send.mock.calls.map(([args]) => args.content)).toEqual([expect.stringContaining('Original brief'), expect.stringContaining('Original brief')])
    })
    it('resumes an unloaded preapproved child to retry an undelivered task', async () => {
      seed()
      const { parent, host, createSession, sessions } = environment()
      createSession.mockImplementationOnce((options: SessionCreateOptions) => {
        const child = fakeSession(options.id!)
        vi.mocked(child.send).mockRejectedValueOnce(new Error('Temporary send failure'))
        sessions.set(child.id, child)
        return child
      })
      const launch = parsed(await requestSessionAgents(parent.id, proposal(), host)).launches[0]
      await expect(startSessionAgent(parent.id, { launchId: launch.launchId, task: 'Original brief' }, host)).rejects.toThrow('Temporary send failure')
      const child = [...sessions.values()].find((session) => session.id !== parent.id)!
      sessions.delete(child.id)
      vi.mocked(host.resumeSession).mockReturnValue(child)
      expect(parsed(await startSessionAgent(parent.id, { launchId: launch.launchId }, host))).toMatchObject({ sessionId: child.id, reused: true })
      expect(host.resumeSession).toHaveBeenCalledWith(child.id, { passive: true })
      expect(createSession).toHaveBeenCalledTimes(1)
      expect(child.send).toHaveBeenCalledTimes(2)
    })
    it('does not redeliver a retry into a child whose worktree has gone missing', async () => {
      seed()
      const { parent, host } = environment()
      const launch = parsed(await requestSessionAgents(parent.id, proposal(), host)).launches[0]
      const started = parsed(await startSessionAgent(parent.id, { launchId: launch.launchId, task: 'Original brief' }, host))
      const child = host.getSession(started.sessionId)!
      Object.assign(child.snapshot, { worktreeMissing: true })
      expect(parsed(await startSessionAgent(parent.id, { launchId: launch.launchId }, host)).status).toBe('error')
      expect(child.send).toHaveBeenCalledTimes(1)
    })
    it.each(['profileApproval', 'handoffSessionId', 'codexServiceTier', 'codexPermissionPreset'])('rejects agent-supplied host bookkeeping: %s', async (key) => {
      seed()
      const { parent, host } = environment()
      await expect(requestSessionAgents(parent.id, proposal('implementer', { [key]: 'forged' }), host)).rejects.toThrow(/host-owned/)
      expect(fixture.db().prepare('SELECT COUNT(*) AS count FROM session_collaboration_grants').get()).toEqual({ count: 0 })
    })
    it.each([
      { model: 'alternate-model' }, { effort: 'low' }, { permissionMode: 'bypassPermissions' }, { sandboxMode: 'on' },
      { apiProviderId: 'api-1' }, { cwd: '/private/tmp' }, { claudeFastMode: true },
      { worktree: { enabled: true, mode: 'attach', baseBranch: 'main' } },
      { worktree: { enabled: true, mode: 'branch', branchName: 'work', carryLocalChanges: true } },
    ])('requires normal approval for launch override %j', async (config) => {
      seed()
      const { parent, host } = environment()
      const pending = requestSessionAgents(parent.id, proposal('implementer', config), host)
      const request = permission(parent)
      resolveSessionAgentsConfirm(request.requestId, 'decline')
      expect(parsed(await pending).status).toBe('rejected')
    })
    it('allows explicitly reviewed same-repo branch and detach worktree scope', async () => {
      seed()
      const { parent, host } = environment()
      for (const mode of ['branch', 'detach'] as const) {
        const result = parsed(await requestSessionAgents(parent.id, proposal('implementer', { worktree: { enabled: true, mode, baseBranch: 'HEAD', ...(mode === 'branch' ? { branchName: 'task/test' } : {}) } }), host))
        expect(result.approval).toBe('saved_profile')
      }
      expect((parent.emitHostEvent as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
    })
    it.each(['mutation', 'deletion'] as const)('refuses a new runtime when the Profile changes after request: %s', async (kind) => {
      seed()
      const { parent, host, createSession } = environment()
      const launch = parsed(await requestSessionAgents(parent.id, proposal(), host)).launches[0]
      const row = fixture.providers().find((p) => p.id === 'implementer')!
      if (kind === 'mutation') row.config = { ...(row.config as object), changedConnection: true }
      else fixture.providers().splice(fixture.providers().indexOf(row), 1)
      const result = parsed(await startSessionAgent(parent.id, { launchId: launch.launchId, task: 'Build' }, host))
      expect(result.status).toBe('error')
      expect(result.message).toMatch(/approval or configuration changed/)
      expect(createSession).not.toHaveBeenCalled()
    })
    it('rechecks approval after asynchronous project preparation before creating the runtime', async () => {
      seed()
      const { parent, host, createSession } = environment()
      const launch = parsed(await requestSessionAgents(parent.id, proposal(), host)).launches[0]
      fixture.duringProjectResolution(() => { fixture.providers().find((p) => p.id === 'implementer')!.name = 'Changed during preparation' })
      await expect(startSessionAgent(parent.id, { launchId: launch.launchId, task: 'Build' }, host)).rejects.toThrow(/approval or configuration changed/)
      expect(createSession).not.toHaveBeenCalled()
    })
    it('cancels a mixed batch without issuing even the otherwise preapproved grant', async () => {
      seed()
      const { parent, host } = environment()
      const pending = requestSessionAgents(parent.id, { launches: [...proposal().launches, ...proposal('claude-base', { effort: 'low' }).launches] }, host)
      const request = permission(parent)
      expect(request.sessionAgentsConfirm!.launches.map((p) => p.agentId)).toEqual(['claude-base'])
      resolveSessionAgentsConfirm(request.requestId, 'decline')
      expect(parsed(await pending).status).toBe('rejected')
      expect(fixture.db().prepare('SELECT COUNT(*) AS count FROM session_collaboration_grants').get()).toEqual({ count: 0 })
    })
    it('does not persist grants when a mixed approval is aborted', async () => {
      seed()
      const { parent, host } = environment()
      const controller = new AbortController()
      const pending = requestSessionAgents(parent.id, { launches: [...proposal().launches, ...proposal('claude-base', { effort: 'low' }).launches] }, host, controller.signal)
      const request = permission(parent)
      controller.abort()
      expect(parsed(await pending).status).toBe('cancelled')
      expect(resolveSessionAgentsConfirm(request.requestId, 'accept')).toBe(false)
      expect(fixture.db().prepare('SELECT COUNT(*) AS count FROM session_collaboration_grants').get()).toEqual({ count: 0 })
    })
    it('revalidates the preapproved part of a mixed batch after user review', async () => {
      seed()
      const { parent, host } = environment()
      const pending = requestSessionAgents(parent.id, { launches: [...proposal().launches, ...proposal('claude-base', { effort: 'low' }).launches] }, host)
      fixture.providers().find((p) => p.id === 'implementer')!.name = 'Changed while awaiting review'
      resolveSessionAgentsConfirm(permission(parent).requestId, 'accept')
      await expect(pending).rejects.toThrow(/approval or configuration changed/)
      expect(fixture.db().prepare('SELECT COUNT(*) AS count FROM session_collaboration_grants').get()).toEqual({ count: 0 })
    })
  })

  describe('legacy ACP Profile approval identity', () => {
    function legacy(agentId: string | null, source: 'preference' | 'cache' = 'preference') {
      seed(false)
      const row = fixture.providers().find((p) => p.id === 'implementer')!
      row.harnessId = 'acp'
      fixture.setAcpAgent(agentId, source)
      const profile = listSessionAgentProfiles().find((p) => p.id === row.id)!
      expect((row.config as Record<string, unknown>).agentId).toBeUndefined()
      approveAgentProfile(row, profile.defaultConfig, selectedApprovalProvider(profile))
      return profile
    }
    it('requires normal approval when the selected agent changes after legacy review', async () => {
      legacy('agent-before')
      fixture.setAcpAgent('agent-after', 'preference')
      const profile = listSessionAgentProfiles().find((p) => p.id === 'implementer')!
      expect(profile.acpAgentId).toBe('agent-after')
      expect(isAgentProfileApproved(profile)).toBe(false)
      const { parent, host } = environment()
      const pending = requestSessionAgents(parent.id, proposal(), host)
      resolveSessionAgentsConfirm(permission(parent).requestId, 'decline')
      expect(parsed(await pending).status).toBe('rejected')
    })
    it.each(['preference', 'cache'] as const)('rejects identity drift between request and start via %s selection', async (source) => {
      const reviewed = legacy('agent-before', source)
      expect(isAgentProfileApproved(reviewed)).toBe(true)
      const { parent, host, createSession } = environment()
      const launch = parsed(await requestSessionAgents(parent.id, proposal(), host)).launches[0]
      fixture.setAcpAgent('agent-after', source)
      const result = parsed(await startSessionAgent(parent.id, { launchId: launch.launchId, task: 'Build' }, host))
      expect(result.status).toBe('error')
      expect(result.message).toMatch(/approval or configuration changed/)
      expect(createSession).not.toHaveBeenCalled()
    })
    it('does not preapprove an unresolved legacy ACP identity', async () => {
      const reviewed = legacy(null)
      expect(reviewed.acpAgentId).toBeUndefined()
      expect(isAgentProfileApproved(reviewed)).toBe(false)
      const { parent, host } = environment()
      const pending = requestSessionAgents(parent.id, proposal(), host)
      resolveSessionAgentsConfirm(permission(parent).requestId, 'decline')
      expect(parsed(await pending).status).toBe('rejected')
    })
    it('rejects a previously resolved identity that disappears before start', async () => {
      legacy('agent-before', 'cache')
      const { parent, host, createSession } = environment()
      const launch = parsed(await requestSessionAgents(parent.id, proposal(), host)).launches[0]
      fixture.setAcpAgent(null, 'cache')
      expect(parsed(await startSessionAgent(parent.id, { launchId: launch.launchId, task: 'Build' }, host)).status).toBe('error')
      expect(createSession).not.toHaveBeenCalled()
    })
    it('rechecks legacy identity after asynchronous project preparation', async () => {
      legacy('agent-before')
      const { parent, host, createSession } = environment()
      const launch = parsed(await requestSessionAgents(parent.id, proposal(), host)).launches[0]
      fixture.duringProjectResolution(() => fixture.setAcpAgent('agent-after', 'preference'))
      await expect(startSessionAgent(parent.id, { launchId: launch.launchId, task: 'Build' }, host)).rejects.toThrow(/approval or configuration changed/)
      expect(createSession).not.toHaveBeenCalled()
    })
    it('keeps a pinned Profile on its reviewed agent when the global selection changes', async () => {
      legacy('agent-before')
      const row = fixture.providers().find((p) => p.id === 'implementer')!
      row.config = { ...(row.config as object), agentId: 'agent-pinned' }
      const profile = listSessionAgentProfiles().find((p) => p.id === row.id)!
      approveAgentProfile(row, profile.defaultConfig, selectedApprovalProvider(profile))
      const { parent, host, createSession } = environment()
      const launch = parsed(await requestSessionAgents(parent.id, proposal(), host)).launches[0]
      fixture.setAcpAgent('agent-after', 'preference')
      expect(parsed(await startSessionAgent(parent.id, { launchId: launch.launchId, task: 'Build' }, host)).status).toBe('started')
      expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ acpAgentId: 'agent-pinned' }))
    })
  })
}
