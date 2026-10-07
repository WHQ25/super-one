import { describe, expect, it } from 'vitest'
import { claudeMessageOrigin } from './claude-message-origin'

describe('claudeMessageOrigin', () => {
  it('stamps the user\'s own text human, typed now or scheduled', () => {
    expect(claudeMessageOrigin(undefined)).toEqual({ kind: 'human' })
    expect(claudeMessageOrigin('user')).toEqual({ kind: 'human' })
  })

  it('leaves collaboration and host wake-ups unattributed', () => {
    expect(claudeMessageOrigin('collaboration')).toBeUndefined()
    expect(claudeMessageOrigin('task-notification')).toBeUndefined()
  })
})
