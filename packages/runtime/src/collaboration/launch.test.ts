import { describe, expect, it } from 'vitest'
import { SESSION_AGENT_LAUNCHES_FIELD, type SessionAgentLaunchProposal } from '@superone/shared/agent-types'
import { CollaborationError } from './errors'
import {
  deriveCollaborationName,
  deriveCollaborationRole,
  mergeConfirmedLaunches,
  normalizeLaunchText,
  patchEditableLaunchConfig,
} from './launch'
import { collaborationSystemPrompt } from './text'

describe('collaboration labels', () => {
  it('deriveCollaborationRole prefers explicit role then launchId', () => {
    expect(deriveCollaborationRole({ role: 'Reviewer', task: 'x' })).toBe('Reviewer')
    expect(deriveCollaborationRole({ launchId: 'diff-bot', task: 'x' })).toBe('diff-bot')
    expect(deriveCollaborationRole({ task: 'You are a tester' })).toBe('a tester')
  })

  it('deriveCollaborationName prefers explicit name', () => {
    expect(deriveCollaborationName({ name: 'Alice' })).toBe('Alice')
    expect(deriveCollaborationName({ launchId: 'bot-1' })).toBe('bot-1')
  })

  it('collaborationSystemPrompt embeds credential and parent id', () => {
    const prompt = collaborationSystemPrompt('s1sc_secret', 'parent-1')
    expect(prompt).toContain('parent-1')
    expect(prompt).toContain('s1sc_secret')
    expect(prompt).toContain('session_collab_send')
  })
})

describe('normalizeLaunchText', () => {
  it('requires spawn and handoff launches to name the new session', () => {
    expect(() => normalizeLaunchText('spawn', { task: 'Do it', role: 'Dev' })).toThrow(/non-empty name/)
    expect(() => normalizeLaunchText('handoff', { task: 'Do it', name: 'Ada' })).toThrow(/non-empty role/)
    expect(() => normalizeLaunchText('spawn', { name: 'Ada', role: 'Dev' })).toThrow(CollaborationError)
  })

  it('defaults link labels from the existing peer', () => {
    expect(normalizeLaunchText('link', { summary: 'Sync' }, 'Peer title')).toEqual({
      task: '',
      summary: 'Sync',
      name: 'Peer title',
      role: 'Peer',
    })
  })
})

describe('confirmed launch merge', () => {
  const proposed: SessionAgentLaunchProposal[] = [{
    launchId: 'a',
    mode: 'spawn',
    agentId: 'claude-base',
    summary: 's',
    task: 't',
    name: 'Ada',
    role: 'Dev',
    config: { permissionMode: 'default', sandboxMode: 'off', cwd: '/repo', name: 'Ada', role: 'Dev' },
  }]

  it('applies only editable fields and rejects unknown modes', () => {
    const merged = mergeConfirmedLaunches(proposed, {
      [SESSION_AGENT_LAUNCHES_FIELD]: JSON.stringify([{
        launchId: 'a',
        mode: 'handoff',
        agentId: 'other',
        config: { permissionMode: 'bypassPermissions', sandboxMode: 'bogus', cwd: '/elsewhere', model: 'm2' },
      }]),
    })
    expect(merged[0]).toMatchObject({ mode: 'spawn', agentId: 'claude-base' })
    expect(merged[0].config).toMatchObject({
      permissionMode: 'bypassPermissions',
      sandboxMode: 'off',
      cwd: '/repo',
      model: 'm2',
    })
  })

  it('rejects a confirm that changes the launch set', () => {
    expect(() => mergeConfirmedLaunches(proposed, {
      [SESSION_AGENT_LAUNCHES_FIELD]: JSON.stringify([{ launchId: 'b' }]),
    })).toThrow(/Unknown launchId/)
  })

  it('patchEditableLaunchConfig keeps an explicit null provider', () => {
    expect(patchEditableLaunchConfig({ apiProviderId: 'api-1' }, { apiProviderId: null }).apiProviderId).toBeNull()
  })
})
