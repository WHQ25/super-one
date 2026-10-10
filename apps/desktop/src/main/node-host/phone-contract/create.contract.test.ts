import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDraftStore, DraftControl } from '@superone/runtime/drafts'
import type { DraftOpenResult } from '@superone/shared/environment'

vi.mock('../../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))
vi.mock('../../git/worktree-ops', () => ({ activateWorktree: vi.fn() }))
vi.mock('../../git-run', () => ({ gitRun: vi.fn(async () => '') }))

import { activateWorktree } from '../../git/worktree-ops'
import { gitRun } from '../../git-run'
import { connectPhone, phoneDomain } from '../phone-endpoint-test-fixtures'

const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!(); vi.clearAllMocks() })

function createDomain() {
  const db = new Database(':memory:')
  cleanup.push(() => db.close())
  const drafts = new DraftControl(createDraftStore(db))
  return { ...phoneDomain(cleanup, { drafts }), drafts }
}

describe('phone endpoint: native creation', () => {
  it.each(['lan', 'relay'] as const)('retains the chosen id, agent and worktree selections over %s and dedupes a lost receipt', async (transport) => {
    const { domain, projectDir, sessions } = createDomain()
    const worktree = join(projectDir, 'worktree')
    mkdirSync(worktree)
    vi.mocked(activateWorktree).mockResolvedValue({ ok: true, path: worktree, recordedBranch: null })
    const created = vi.spyOn(sessions, 'createSession')
    const phone = await connectPhone(domain, { transport })
    cleanup.push(phone.close)
    const input = { projectId: 'p1', harnessId: 'acp', sessionId: 'chosen', acpAgentId: 'grok', worktreeBranch: 'HEAD', worktreeMode: 'detach', worktreeCarryLocalChanges: false, options: { model: 'm', effort: 'high', mode: 'build', agentPreset: 'preset', additionalDirectories: ['/extra'] } }
    const result = await phone.rpc('session.create', input, 'native-create')
    expect(result).toMatchObject({ sessionId: 'chosen', cwd: worktree, model: 'm', effort: 'high', mode: 'build', agentPreset: 'preset' })
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ id: 'chosen', providerId: 'acp-base', acpAgentId: 'grok', cwd: worktree, gitBranch: null, model: 'm', additionalDirectories: ['/extra'] }))
    expect(activateWorktree).toHaveBeenCalledWith(projectDir, { baseBranch: 'HEAD', mode: 'detach', branchName: undefined, carryLocalChanges: false })
    expect(await phone.rpc('session.create', input, 'native-create')).toEqual(result)
    expect(created).toHaveBeenCalledOnce()
    expect(domain.leases.get({ environmentId: domain.identity.environmentId, sessionId: 'chosen' })?.delegate).toBe('phone:phone-1')
  })

  it('promotes only an empty session authorized by the current draft holder', async () => {
    const { domain, drafts, projectDir, sessions, own } = createDomain()
    drafts.upsert({ id: 'draft', text: 'input', projectPath: projectDir, originSessionId: 'own' })
    const phone = await connectPhone(domain, { deviceId: 'a' })
    const other = await connectPhone(domain, { deviceId: 'b' })
    cleanup.push(phone.close, other.close)
    const opened = await phone.rpc<DraftOpenResult>('draft.open', { draftId: 'draft' })
    const input = { projectId: 'p1', harnessId: 'codex', sessionId: 'own', draftId: 'draft', draftLeaseId: opened.leaseId, options: { model: 'saved' } }
    await expect(other.rpc('session.create', input)).rejects.toThrow('Draft control was released')
    expect(sessions.getSession('own')).toBe(own)
    const created = vi.spyOn(sessions, 'createSession')
    expect(await phone.rpc('session.create', input)).toMatchObject({ sessionId: 'own', model: 'saved' })
    expect(sessions.getSession('own')).not.toBe(own)
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ id: 'own', providerId: 'codex-base' }))
    await expect(phone.rpc('session.create', { projectId: 'p1', sessionId: 'own' })).rejects.toThrow('Session already exists')
  })

  it('rechecks the draft grant after worktree activation and rolls back without persisting a session', async () => {
    const { domain, drafts, projectDir, store, sessions } = createDomain()
    drafts.upsert({ id: 'draft', text: 'input', projectPath: projectDir })
    const phone = await connectPhone(domain, { deviceId: 'a' })
    cleanup.push(phone.close)
    const opened = await phone.rpc<DraftOpenResult>('draft.open', { draftId: 'draft' })
    const path = join(projectDir, 'new-worktree')
    vi.mocked(activateWorktree).mockImplementation(async () => {
      drafts.releaseDevice('phone:a')
      return { ok: true, path, recordedBranch: null }
    })
    await expect(phone.rpc('session.create', { projectId: 'p1', sessionId: 'new', worktreeBranch: 'HEAD', worktreeMode: 'detach', draftId: 'draft', draftLeaseId: opened.leaseId })).rejects.toThrow('Draft control was released')
    expect(store.get('new')).toBeNull()
    expect(sessions.getSession('new')).toBeNull()
    expect(gitRun).toHaveBeenCalledWith(projectDir, ['worktree', 'remove', '--force', path])
  })

  it.each([{ sessionId: '../escape' }, { worktreeMode: 'detach' }, { draftId: 'draft' }, { options: { model: 3 } }])('rejects malformed native selections before writes: %j', async (selection) => {
    const { domain, store } = createDomain()
    const phone = await connectPhone(domain)
    cleanup.push(phone.close)
    const before = store.rows.size
    await expect(phone.rpc('session.create', { projectId: 'p1', ...selection })).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(store.rows.size).toBe(before)
    expect(activateWorktree).not.toHaveBeenCalled()
  })
})
