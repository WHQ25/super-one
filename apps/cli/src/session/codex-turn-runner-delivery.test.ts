import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { CodexSpawnFn } from '@superone/codex'
import { sendDeliveryHarness } from '@superone/runtime/session/send-delivery.test-support'
import { createNodeCodexTurnRunner } from './codex-turn-runner'

/** A scripted app-server: `fail` names a method answered with an error instead of its result. */
function fakeAppServer(script: { fail: string | null; turnStarts: number }): CodexSpawnFn {
  return () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const events = new EventEmitter()
    const write = (msg: Record<string, unknown>) => stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`)
    stdin.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n').filter((l) => l.trim())) {
        const { id, method } = JSON.parse(line) as { id?: number; method?: string }
        if (id === undefined || !method) continue
        if (method === 'turn/start') script.turnStarts += 1
        if (method === script.fail) {
          write({ id, error: { code: -32000, message: `${method} failed` } })
        } else if (method === 'thread/start') {
          write({ id, result: { thread: { id: 't-1' } } })
        } else if (method === 'turn/start') {
          write({ id, result: { turn: { id: 'turn-1' } } })
          write({ method: 'item/agentMessage/delta', params: { itemId: 'm1', delta: 'done' } })
          write({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } })
        } else {
          write({ id, result: {} })
        }
      }
    })
    const child = {
      stdin, stdout, stderr: new PassThrough(), killed: false,
      kill: () => { child.killed = true; queueMicrotask(() => events.emit('exit', 0, null)); stdout.end(); return true },
      on: events.on.bind(events), once: events.once.bind(events), emit: events.emit.bind(events),
    }
    return child as unknown as ChildProcessWithoutNullStreams
  }
}

describe('Codex runner input delivery', () => {
  const dirs: string[] = []
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

  const harness = (script: { fail: string | null; turnStarts: number }) => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-delivery-'))
    dirs.push(dir)
    const bin = join(dir, 'codex')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    const runner = createNodeCodexTurnRunner({ binaryPath: bin, resolveProjectPath: () => dir, spawnFn: fakeAppServer(script), allowSimulatedFallback: false })
    return { ...sendDeliveryHarness(runner, 'codex', dir), dispose: () => runner.disposeAll?.() }
  }

  it('keeps a message whose thread never opened retryable, and runs its resend', async () => {
    const script = { fail: 'thread/start' as string | null, turnStarts: 0 }
    const h = harness(script)
    const failed = await h.send('u1')
    expect(script.turnStarts).toBe(0)
    expect(failed.status).toBe('idle')
    expect(h.failureOf(failed, 'u1')?.error).toMatch(/thread\/start failed/)

    script.fail = null
    const answered = await h.send('u1')
    expect(script.turnStarts).toBe(1)
    expect(h.failureOf(answered, 'u1')).toBeUndefined()
    expect(h.lastAssistantText(answered)).toBe('done')
    await h.dispose()
  })

  it('holds a message once turn/start went out, even when its answer is an error', async () => {
    const script = { fail: 'turn/start' as string | null, turnStarts: 0 }
    const h = harness(script)
    const failed = await h.send('u1')
    expect(failed.status).toBe('error')
    expect(h.failureOf(failed, 'u1')).toBeUndefined()

    script.fail = null
    await h.send('u1')
    expect(script.turnStarts).toBe(1)
    await h.dispose()
  })
})
