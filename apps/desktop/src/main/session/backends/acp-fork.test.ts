import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForkContext, ForkSource } from '../types'
import { forkAcpTranscript, setGrokForkConnector } from './acp-fork'

const connector = vi.fn(async () => 'forked-grok')

function source(overrides: Partial<ForkSource> = {}): ForkSource {
  return {
    providerSessionId: 'src-session',
    projectPath: '/project',
    cwd: '/source',
    providerConfig: { agentId: 'grok-build' },
    ...overrides,
  }
}

beforeEach(() => {
  connector.mockClear()
  connector.mockResolvedValue('forked-grok')
  setGrokForkConnector(connector)
})

afterEach(() => {
  setGrokForkConnector(null)
})

describe('forkAcpTranscript', () => {
  it('forks through x.ai/session/fork with source cwd and target cwd', async () => {
    const ctx: ForkContext = { messages: [] }
    expect(await forkAcpTranscript(source(), '/target', ctx)).toBe('forked-grok')
    expect(connector).toHaveBeenCalledWith(expect.objectContaining({
      sourceSessionId: 'src-session',
      sourceCwd: '/source',
      newCwd: '/target',
      sessionKind: 'fork',
      sourceWorkspaceDir: '/source',
      agentId: 'grok-build',
    }))
    expect(connector.mock.calls[0][0].targetPromptIndex).toBeUndefined()
  })

  it('maps forkFromMessageId onto Grok targetPromptIndex (keep through that turn)', async () => {
    const ctx: ForkContext = {
      forkFromMessageId: 'a1',
      messages: [
        {
          id: 'u1', role: 'user', status: 'complete', content: [], createdAt: '',
          providerId: 'local', checkpointId: 'u1',
        },
        {
          id: 'a1', role: 'assistant', status: 'complete', content: [], createdAt: '',
          providerId: 'local',
        },
        {
          id: 'u2', role: 'user', status: 'complete', content: [], createdAt: '',
          providerId: 'local', checkpointId: 'u2',
        },
      ],
    }
    await forkAcpTranscript(source(), '/source', ctx)
    expect(connector).toHaveBeenCalledWith(expect.objectContaining({
      newCwd: '/source',
      targetPromptIndex: 1,
    }))
    expect(connector.mock.calls[0][0].sourceWorkspaceDir).toBeUndefined()
  })
})
