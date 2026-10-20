/** @vitest-environment jsdom */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { dismissContinuationOffer, useSessionContinuationOffer } from './session-continuation-offer'

const projectPath = '/tmp/continuation-offer'
const previousChat = useChatStore.getState()
const previousHint = useAppStore.getState().sessionContinuationHint

function turn(completedAt: string, cacheTtl?: '5m' | '1h'): ChatMessage {
  return {
    id: `a-${completedAt}`,
    role: 'assistant',
    status: 'complete',
    providerId: 'claude',
    createdAt: completedAt,
    content: [{ type: 'text', text: 'done' }],
    metadata: {
      completedAt,
      usage: {
        inputTokens: 12,
        outputTokens: 400,
        cacheReadInputTokens: 410_000,
        cacheCreationInputTokens: 2_000,
        ...(cacheTtl ? { cacheTtl } : {}),
      },
    },
  }
}

function seed(sessionId: string, message: ChatMessage): void {
  const session = createDefaultPerSessionState()
  Object.assign(session, {
    status: 'idle',
    messages: [message],
    contextTokens: 412_012,
  })
  useChatStore.setState({
    activeProject: projectPath,
    projectSessions: {
      [projectPath]: {
        ...createDefaultProjectState(),
        _activeSessionId: sessionId,
        _sessions: { [sessionId]: session },
      },
    },
  })
  useAppStore.setState({ sessionContinuationHint: { enabled: true, minContextTokens: 300_000 } })
}

afterEach(() => {
  cleanup()
  act(() => {
    useChatStore.setState(previousChat, true)
    useAppStore.setState({ sessionContinuationHint: previousHint })
  })
})

describe('useSessionContinuationOffer', () => {
  it('hides a dismissed handoff without leaving the session, and shows the next expiry', () => {
    const sessionId = 'dismiss-stays'
    const expired = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
    seed(sessionId, turn(expired, '1h'))
    const { result } = renderHook(() => useSessionContinuationOffer())
    expect(result.current).toMatchObject({ sessionId })

    act(() => { dismissContinuationOffer(result.current!) })
    expect(result.current).toBeNull()

    const expiredAgain = new Date(Date.now() - 3 * 60 * 60_000).toISOString()
    act(() => { seed(sessionId, turn(expiredAgain, '1h')) })
    expect(result.current).toMatchObject({ sessionId, expiresAt: Date.parse(expiredAgain) + 60 * 60_000 })
  })

  it('feeds the dismissal into the compiled render, so the compiler cannot keep the old offer', () => {
    const require = createRequire(import.meta.url)
    const { transformSync } = require('@babel/core') as typeof import('@babel/core')
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'session-continuation-offer.ts'), 'utf8')
    const compiled = transformSync(source, {
      filename: 'session-continuation-offer.tsx',
      babelrc: false,
      configFile: false,
      plugins: [['babel-plugin-react-compiler', { target: '19' }]],
      parserOpts: { plugins: ['typescript', 'jsx'] },
    })?.code ?? ''
    const due = compiled.slice(compiled.indexOf('const due = '), compiled.indexOf(';', compiled.indexOf('const due = ')))
    expect(due).toContain('dismissedExpiresAt')
    expect(due).not.toContain('dismissed.get')
  })

  it('does not offer a handoff when the turn reported no cache TTL', () => {
    const expired = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
    seed('no-ttl', turn(expired))
    const { result } = renderHook(() => useSessionContinuationOffer())
    expect(result.current).toBeNull()
  })
})
