import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'

const { getDb } = vi.hoisted(() => ({
  getDb: vi.fn(() => { throw new Error('Native restore fixture accessed the real database') }),
}))
vi.mock('../database', () => ({ getDb }))

import { nativeSessionLoad } from './native-restore.test-fixtures'

describe('native restore fixture isolation', () => {
  it('loads passive history without an application database or data directory', async () => {
    const message: ChatMessage = {
      id: 'question', role: 'user', status: 'complete', providerId: 'claude',
      content: [{ type: 'text', text: 'Continue' }], createdAt: '',
    }
    await expect(nativeSessionLoad(null, undefined, [message])).resolves.toMatchObject({
      sessionId: 'session', messages: [message], before: null, after: null,
    })
    expect(getDb).not.toHaveBeenCalled()
  })
})
