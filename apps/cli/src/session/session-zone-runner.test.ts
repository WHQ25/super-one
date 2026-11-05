import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodexVoiceConnection, NodeSessionRecord, TurnRunner } from '@superone/runtime/session'
import { withSessionZone } from './session-zone-runner'

let root: string
afterEach(() => rmSync(root, { recursive: true, force: true }))

function session(): NodeSessionRecord {
  return { sessionId: 'sess-1', projectId: 'p', harnessId: 'claude', cwd: '/proj' } as NodeSessionRecord
}

describe('session zone turn wrapper', () => {
  it('hands the runner the session directory and grants only its agent/ subdirectory', async () => {
    root = mkdtempSync(join(tmpdir(), 'zone-runner-'))
    const seen: Parameters<TurnRunner>[0][] = []
    const inner: TurnRunner = async (input) => {
      seen.push(input)
      return { finalText: 'ok' }
    }
    const runner = withSessionZone(inner, join(root, 'sync'))
    await runner({ session: session(), text: 'hi', additionalDirectories: ['/extra'], onDelta: () => {}, signal: new AbortController().signal })
    expect(seen[0].sessionDir).toBe(join(root, 'sync', 'sess-1'))
    expect(seen[0].additionalDirectories).toEqual(['/extra', join(root, 'sync', 'sess-1', 'agent')])
    expect(existsSync(join(root, 'sync', 'sess-1', 'agent'))).toBe(true)
    // A second turn (cold resume, next send) does not stack the grant.
    await runner({ session: session(), text: 'again', additionalDirectories: seen[0].additionalDirectories, onDelta: () => {}, signal: new AbortController().signal })
    expect(seen[1].additionalDirectories).toEqual(seen[0].additionalDirectories)
  })

  it('keeps the lifecycle hooks of the runner it wraps', () => {
    root = mkdtempSync(join(tmpdir(), 'zone-runner-'))
    const inner: TurnRunner = async () => ({ finalText: '' })
    inner.disposeSession = async () => {}
    const runner = withSessionZone(inner, root)
    expect(runner.disposeSession).toBe(inner.disposeSession)
  })

  it('opens the Codex voice connection without starting a text turn', async () => {
    root = mkdtempSync(join(tmpdir(), 'zone-runner-'))
    const connection: CodexVoiceConnection = {
      threadId: 'thread-1',
      request: vi.fn(async () => ({})),
      subscribe: vi.fn(() => () => {}),
      setVoiceActive: vi.fn(),
    }
    const inner: TurnRunner = vi.fn(async () => ({ finalText: '' }))
    const open = vi.fn(async () => connection)
    inner.codexVoice = { open }
    const runner = withSessionZone(inner, root)
    const voiceSession = { ...session(), harnessId: 'codex' }

    expect(runner.codexVoice).toBeDefined()
    expect(await runner.codexVoice!.open(voiceSession)).toBe(connection)
    expect(open).toHaveBeenCalledExactlyOnceWith(voiceSession)
    expect(inner).not.toHaveBeenCalled()
  })
})
