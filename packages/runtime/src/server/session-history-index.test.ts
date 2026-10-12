import { describe, expect, it, vi } from 'vitest'
import type { SessionHistoryIndex } from '@superone/shared/session-history-index'
import { textMessage } from '@superone/shared/transcript-window/window-fixtures'
import type { RpcContext, SessionHostPort } from './rpc-context'
import { handleSessionHistoryIndex } from './rpc-session-reads'

const client = { clientSessionId: 'c', scopes: ['session:read'], devicePublicKeyFingerprint: 'fp', devicePublicKeyPem: 'pem' }

describe('session.historyIndex', () => {
  it('builds the index from the transcript on a host without its own', async () => {
    const sessions = {
      get: () => ({ projectId: 'p' }),
      messages: () => [textMessage('u1', 'user', 'First question'), textMessage('a1', 'assistant', 'Answer'), textMessage('u2', 'user', 'Second')],
    } as unknown as SessionHostPort
    const reply = await handleSessionHistoryIndex({ sessionId: 's' }, { client, sessions } as unknown as RpcContext)
    const index = reply.result as SessionHistoryIndex
    expect(index.messageIds).toEqual(['u1', 'a1', 'u2'])
    expect(index.entries.map((entry) => entry.text)).toEqual(expect.arrayContaining(['First question', 'Second']))
  })

  it('prefers the host index', async () => {
    const own: SessionHistoryIndex = { messageIds: ['x'], entries: [], compacts: [] }
    const historyIndex = vi.fn(async () => own)
    const sessions = { get: () => ({ projectId: 'p' }), messages: () => [], historyIndex } as unknown as SessionHostPort
    expect((await handleSessionHistoryIndex({ sessionId: 's' }, { client, sessions } as unknown as RpcContext)).result).toBe(own)
    expect(historyIndex).toHaveBeenCalledWith('s')
  })
})
