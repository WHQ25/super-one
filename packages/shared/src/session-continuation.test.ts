import { describe, expect, it } from 'vitest'
import type { ChatMessage, UsageInfo } from './agent-types'
import {
  DEFAULT_SESSION_CONTINUATION_HINT,
  readSessionContinuationHint,
  sessionCacheExpiresAt,
} from './session-continuation'

const COMPLETED = '2026-10-16T10:00:00.000Z'
const COMPLETED_MS = Date.parse(COMPLETED)
const settings = { enabled: true, minContextTokens: 300_000 }

function usage(total: number, cacheTtl?: UsageInfo['cacheTtl']): UsageInfo {
  return { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: total - 10, cacheCreationInputTokens: 0, ...(cacheTtl ? { cacheTtl } : {}) }
}

function assistant(metadata: ChatMessage['metadata'], status: ChatMessage['status'] = 'complete'): ChatMessage {
  return { id: `a-${Math.random()}`, role: 'assistant', status, content: [], createdAt: COMPLETED, providerId: 'claude', metadata }
}

const user: ChatMessage = { id: 'u', role: 'user', status: 'complete', content: [], createdAt: COMPLETED, providerId: 'claude' }

describe('sessionCacheExpiresAt', () => {
  it('expires one TTL after the newest finished turn when the context is large enough', () => {
    expect(sessionCacheExpiresAt({
      messages: [user, assistant({ completedAt: COMPLETED, usage: usage(320_000, '1h') })],
      settings,
    })).toBe(COMPLETED_MS + 60 * 60_000)
    expect(sessionCacheExpiresAt({
      messages: [assistant({ completedAt: COMPLETED, usage: usage(320_000, '5m') })],
      settings,
    })).toBe(COMPLETED_MS + 5 * 60_000)
  })

  it('takes the newest reported TTL when the last turn wrote no cache', () => {
    expect(sessionCacheExpiresAt({
      messages: [
        assistant({ completedAt: COMPLETED, usage: usage(310_000, '1h') }),
        user,
        assistant({ completedAt: COMPLETED, usage: usage(320_000) }),
      ],
      settings,
    })).toBe(COMPLETED_MS + 60 * 60_000)
  })

  it('never hints for a harness that reports no TTL', () => {
    expect(sessionCacheExpiresAt({ messages: [assistant({ completedAt: COMPLETED, usage: usage(900_000) })], settings })).toBeNull()
  })

  it('prefers the tracked context size and falls back to the turn usage', () => {
    const messages = [assistant({ completedAt: COMPLETED, usage: usage(120_000, '1h') })]
    expect(sessionCacheExpiresAt({ messages, settings })).toBeNull()
    expect(sessionCacheExpiresAt({ messages, contextTokens: 300_000, settings })).not.toBeNull()
    expect(sessionCacheExpiresAt({ messages, contextTokens: 0, settings: { ...settings, minContextTokens: 100_000 } })).not.toBeNull()
  })

  it('does not hint while a turn runs, before any turn finished, or when turned off', () => {
    const finished = assistant({ completedAt: COMPLETED, usage: usage(320_000, '1h') })
    expect(sessionCacheExpiresAt({ messages: [finished, user, assistant({}, 'streaming')], settings })).toBeNull()
    expect(sessionCacheExpiresAt({ messages: [user], settings })).toBeNull()
    expect(sessionCacheExpiresAt({ messages: [finished], settings: { ...settings, enabled: false } })).toBeNull()
  })
})

describe('readSessionContinuationHint', () => {
  it('clamps the threshold and fills malformed fields from the default', () => {
    expect(readSessionContinuationHint(undefined)).toEqual(DEFAULT_SESSION_CONTINUATION_HINT)
    expect(readSessionContinuationHint({ enabled: false, minContextTokens: 5 })).toEqual({ enabled: false, minContextTokens: 100_000 })
    expect(readSessionContinuationHint({ enabled: 'yes', minContextTokens: 9e9 })).toEqual({ enabled: true, minContextTokens: 1_000_000 })
  })
})
