import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { dateSeparators, formatMessageTime } from './message-time'

const now = new Date(2026, 9, 8, 14, 0).getTime()

function msg(id: string, at: Date, over: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: 'user', status: 'complete', content: [], createdAt: at.toISOString(), providerId: 'claude', ...over }
}

describe('dateSeparators', () => {
  it('leaves a session younger than an hour without a start time', () => {
    expect(dateSeparators([msg('u1', new Date(2026, 9, 8, 13, 30))], now).size).toBe(0)
  })

  it('stamps the first message once the session is an hour old', () => {
    const first = new Date(2026, 9, 8, 12, 59)
    expect(dateSeparators([msg('u1', first), msg('a1', new Date(2026, 9, 8, 13, 0), { role: 'assistant' })], now))
      .toEqual(new Map([['u1', first.getTime()]]))
  })

  it('opens each later calendar day and skips system rows', () => {
    const day2 = new Date(2026, 9, 7, 9, 0)
    const ids = dateSeparators([
      msg('u1', new Date(2026, 9, 6, 23, 50)),
      msg('a1', new Date(2026, 9, 7, 0, 5), { role: 'assistant' }),
      msg('c1', new Date(2026, 9, 8, 8, 0), { role: 'assistant', providerId: 'system' }),
      msg('u2', day2),
      msg('u3', new Date(2026, 9, 8, 10, 0)),
    ], now)
    expect([...ids.keys()]).toEqual(['u1', 'a1', 'u3'])
    expect(ids.has('u2')).toBe(false)
  })

  it('ignores rows without a usable time', () => {
    expect(dateSeparators([msg('u1', new Date(2026, 9, 8, 9, 0), { createdAt: '' })], now).size).toBe(0)
  })
})

describe('formatMessageTime', () => {
  const words = { today: (t: string) => `Today ${t}`, yesterday: (t: string) => `Yesterday ${t}` }

  it('names today and yesterday', () => {
    expect(formatMessageTime(new Date(2026, 9, 8, 13, 46).getTime(), now, 'en', words)).toBe('Today 1:46 PM')
    expect(formatMessageTime(new Date(2026, 9, 8, 13, 46).getTime(), now, 'en', { yesterday: words.yesterday })).toBe('1:46 PM')
    expect(formatMessageTime(new Date(2026, 9, 7, 21, 46).getTime(), now, 'en', words)).toBe('Yesterday 9:46 PM')
  })

  it('uses the weekday within a week, then the date', () => {
    expect(formatMessageTime(new Date(2026, 9, 5, 21, 46).getTime(), now, 'en', words)).toBe('Monday 9:46 PM')
    expect(formatMessageTime(new Date(2026, 8, 1, 21, 46).getTime(), now, 'en', words)).toBe('Sep 1, 9:46 PM')
    expect(formatMessageTime(new Date(2025, 8, 1, 21, 46).getTime(), now, 'en', words)).toBe('Sep 1, 2025, 9:46 PM')
  })

  it('follows the chat locale', () => {
    expect(formatMessageTime(new Date(2026, 9, 5, 21, 46).getTime(), now, 'zh', words)).toBe('星期一 21:46')
    expect(formatMessageTime(new Date(2026, 8, 1, 21, 46).getTime(), now, 'zh', words)).toBe('9月1日 21:46')
  })
})
