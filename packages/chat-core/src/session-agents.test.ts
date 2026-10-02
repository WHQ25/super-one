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
})
