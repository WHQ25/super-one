import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../../shared/agent-types'

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import { CodexBackend } from './codex-backend'

function makeStartOpts() {
  return {
    cwd: '/tmp/proj',
    config: { apiKey: 'codex-key', model: 'gpt-5.4' },
    permissionMode: 'default' as const,
    abortController: new AbortController(),
  }
}

describe('CodexBackend', () => {
  let backend: CodexBackend

  beforeEach(() => {
    backend = new CodexBackend()
  })

  describe('lifecycle', () => {
    it('kind is codex', () => {
      expect(backend.kind).toBe('codex')
    })

    it('start() stores options and marks started', async () => {
      await backend.start(makeStartOpts())
      expect(backend.getStartOpts()).not.toBeNull()
    })

    it('start() throws if called twice without close', async () => {
      await backend.start(makeStartOpts())
      await expect(backend.start(makeStartOpts())).rejects.toThrow(/already started/)
    })

    it('close() disposes and blocks future starts', async () => {
      await backend.start(makeStartOpts())
      await backend.close()
      await expect(backend.start(makeStartOpts())).rejects.toThrow(/disposed/)
    })

    it('send() throws when not started', async () => {
      await expect(backend.send({ content: 'x' })).rejects.toThrow(/not started/)
    })

    it('send() throws "not yet wired" after start (placeholder until Phase 3)', async () => {
      await backend.start(makeStartOpts())
      await expect(backend.send({ content: 'x' })).rejects.toThrow(/not yet wired/)
    })
  })

  describe('event / session-id callbacks', () => {
    it('onEvent forwards emitted events to listeners', async () => {
      const events: AgentEvent[] = []
      backend.onEvent((e) => events.push(e))
      await backend.start(makeStartOpts())
      backend.emitForTest({ type: 'status_change', status: 'streaming' })
      expect(events).toHaveLength(1)
    })

    it('onEvent returns unsubscribe', async () => {
      const events: AgentEvent[] = []
      const unsub = backend.onEvent((e) => events.push(e))
      await backend.start(makeStartOpts())
      unsub()
      backend.emitForTest({ type: 'status_change', status: 'idle' })
      expect(events).toHaveLength(0)
    })

    it('providerSessionId is preset from start opts', async () => {
      await backend.start({ ...makeStartOpts(), providerSessionId: 'thread-123' })
      expect(backend.getCurrentProviderSessionId()).toBe('thread-123')
    })
  })

  describe('unsupported operations degrade gracefully', () => {
    it('rewindFiles returns canRewind:false', async () => {
      await backend.start(makeStartOpts())
      const result = await backend.rewindFiles('msg-1')
      expect(result.canRewind).toBe(false)
    })

    it('getMcpServerStatus returns empty', async () => {
      await backend.start(makeStartOpts())
      expect(await backend.getMcpServerStatus()).toEqual([])
    })

    it('getContextUsage returns null', async () => {
      await backend.start(makeStartOpts())
      expect(await backend.getContextUsage()).toBeNull()
    })
  })
})
