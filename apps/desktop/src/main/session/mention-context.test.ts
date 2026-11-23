import { describe, expect, it, vi } from 'vitest'
import type { SendMessageRequest } from '@superone/shared/agent-types'
import { Session } from './session'
import type { SessionBackend } from './types'
import { withDesktopMentionContext } from './mention-context'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
vi.mock('../shell-env', () => ({ ensureShellPath: vi.fn() }))

describe('desktop mention context', () => {
  it('enriches codex explicit prompt without altering chat content', async () => {
    const request: SendMessageRequest = {
      content: 'chat bubble',
      codex: {
        prompt: 'Check <superone-github><kind>issue</kind><name>#12</name><id>12</id></superone-github>',
        mode: 'run',
      },
    }
    const enriched = await withDesktopMentionContext(request, {
      cwd: '/tmp',
      sessionId: 's-1',
      gh: async () => JSON.stringify({ number: 12, title: 'Bug', state: 'OPEN', body: 'Details' }),
    })

    expect(enriched.content).toBe('chat bubble')
    expect(enriched.codex?.prompt).toContain('<superone-github-context>')
    expect(enriched.codex?.prompt).toContain('### Issue #12: Bug')
  })

  it('attaches context on Session.send without polluting stored user transcript', async () => {
    const send = vi.fn(async (_request: SendMessageRequest) => {})
    const backend = {
      kind: 'claude',
      start: vi.fn(async () => {}),
      send,
      onEvent: () => () => {},
      onProviderSessionId: () => () => {},
      onPermissionModeApplied: () => () => {},
    } as unknown as SessionBackend
    const session = new Session({
      id: 's-1',
      projectPath: '/tmp',
      cwd: '/tmp',
      providerId: 'claude',
      harnessId: 'claude',
      backend,
      providerConfig: {},
    })

    await session.send({ content: 'plain message' })
    expect(send.mock.calls[0]![0].content).toBe('plain message')
    expect(session.snapshot.messages.at(-1)?.content).toEqual([{ type: 'text', text: 'plain message' }])
  })
})
