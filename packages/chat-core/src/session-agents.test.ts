import { describe, expect, it } from 'vitest'
import { createDefaultChatCoreSession } from './defaults'
import { applyEventToSession } from './reducer'

describe('session_agents', () => {
  const agents = [{ id: 'build', name: 'Build' }, { id: 'reviewer', name: 'Reviewer' }]

  it('keeps a project-defined selection the project list offers', () => {
    const session = { ...createDefaultChatCoreSession(), openCodeAgentId: 'reviewer' }
    expect(applyEventToSession(session, { type: 'session_agents', agents })).toEqual({ sessionAgents: agents })
  })

  it('clears a selection the project list no longer offers', () => {
    const session = { ...createDefaultChatCoreSession(), openCodeAgentId: 'removed' }
    expect(applyEventToSession(session, { type: 'session_agents', agents })).toEqual({ sessionAgents: agents, openCodeAgentId: null })
  })

  it('carries runtime capabilities and native skills through the shared desktop/mobile reducer', () => {
    const session = createDefaultChatCoreSession()
    const runtimeCapabilities = { harnessId: 'opencode' as const, supportsQueuedSteer: true, supportsStreamingToolInput: true }
    const commands = [{ name: 'review', description: 'Native skill', argumentHint: '', isSkill: true, skillId: 'skill_review' }]
    const models = [{ id: 'node/model', name: 'Scoped model', description: 'Credential model' }]
    expect(applyEventToSession(session, { type: 'session_agents', agents, runtimeCapabilities, commands, models })).toMatchObject({
      runtimeCapabilities, sessionSlashCommands: commands, sessionModels: models,
    })
  })

  it('clears V2 facts when a resumed catalog belongs to a legacy runtime', () => {
    const session = { ...createDefaultChatCoreSession(), runtimeCapabilities: { harnessId: 'opencode' as const, supportsQueuedSteer: true },
      sessionSlashCommands: [{ name: 'review', description: '', argumentHint: '', isSkill: true, skillId: 'old' }] }
    expect(applyEventToSession(session, { type: 'session_agents', agents })).toMatchObject({
      runtimeCapabilities: undefined, sessionSlashCommands: undefined,
    })
  })
})
