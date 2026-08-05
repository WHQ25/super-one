import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeLiveSession } from './claude-live-session'
import type { ClaudeQueryFn } from './types'

/**
 * Mock that behaves like the real Agent SDK: wait for each bridge user
 * message, then emit stream + result. Enables multi-turn / priority-next tests.
 */
function bridgeAwareQuery(
  respond: (user: SDKUserMessage, turnIndex: number) => Array<Record<string, unknown>>,
): ClaudeQueryFn {
  return (({ prompt }) =>
    (async function* () {
      let i = 0
      for await (const user of prompt as AsyncIterable<SDKUserMessage>) {
        for (const item of respond(user, i++)) {
          yield item as SDKMessage
        }
      }
    })()) as ClaudeQueryFn
}

function textOf(user: SDKUserMessage): string {
  const c = user.message?.content
  return typeof c === 'string' ? c : JSON.stringify(c)
}

function successTurn(sessionId: string, text: string): Array<Record<string, unknown>> {
  return [
    {
      type: 'stream_event',
      session_id: sessionId,
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text },
      },
    },
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      session_id: sessionId,
      result: text,
    },
  ]
}

describe('ClaudeLiveSession', () => {
  it('runs a single turn on the long-lived bridge query', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cls-1-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const queryFn = vi.fn(
      bridgeAwareQuery((user) => successTurn('sess-a', `echo:${textOf(user)}`)),
    )

    const live = ClaudeLiveSession.open({
      cwd: dir,
      binaryPath: bin,
      queryFn,
    })

    const events: Array<{ kind: string; delta?: string }> = []
    const result = await live.sendTurn({
      content: 'hello',
      onEvent: (e) => events.push(e as { kind: string; delta?: string }),
    })

    expect(result.finalText).toBe('echo:hello')
    expect(result.sessionId).toBe('sess-a')
    expect(events.some((e) => e.kind === 'text' && e.delta === 'echo:hello')).toBe(true)
    expect(queryFn).toHaveBeenCalledTimes(1)

    await live.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  it('queues a mid-turn send with priority next and reuses one query process', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cls-2-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const seen: Array<{ text: string; priority?: string }> = []
    let releaseFirst: (() => void) | null = null
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    // First turn waits on gate before result so the second send can queue.
    const gatedQuery: ClaudeQueryFn = ({ prompt }) =>
      (async function* () {
        let i = 0
        for await (const user of prompt as AsyncIterable<SDKUserMessage>) {
          const text = textOf(user)
          const priority =
            typeof (user as { priority?: string }).priority === 'string'
              ? (user as { priority?: string }).priority
              : undefined
          seen.push({ text, priority })
          if (i === 0) {
            yield {
              type: 'stream_event',
              session_id: 'sess-live',
              event: {
                type: 'content_block_delta',
                delta: { type: 'text_delta', text: 'first-out' },
              },
            } as SDKMessage
            await firstGate
            yield {
              type: 'result',
              subtype: 'success',
              is_error: false,
              session_id: 'sess-live',
              result: 'first-out',
            } as SDKMessage
          } else {
            for (const item of successTurn('sess-live', 'second-out')) {
              yield item as SDKMessage
            }
          }
          i++
        }
      })() as ReturnType<ClaudeQueryFn>

    const live = ClaudeLiveSession.open({
      cwd: dir,
      binaryPath: bin,
      queryFn: gatedQuery,
    })

    const firstP = live.sendTurn({ content: 'first' })
    // Wait until first turn is active (stream started).
    await new Promise((r) => setTimeout(r, 20))
    expect(live.isBusy).toBe(true)

    const secondP = live.sendTurn({ content: 'second', priorityNext: true })
    // Release first result — second should flush with priority next.
    releaseFirst!()
    const [first, second] = await Promise.all([firstP, secondP])

    expect(first.finalText).toBe('first-out')
    expect(second.finalText).toBe('second-out')
    expect(seen).toHaveLength(2)
    expect(seen[0]?.text).toBe('first')
    expect(seen[0]?.priority).toBeUndefined()
    expect(seen[1]?.text).toBe('second')
    expect(seen[1]?.priority).toBe('next')

    await live.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects send after dispose', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cls-3-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const live = ClaudeLiveSession.open({
      cwd: dir,
      binaryPath: bin,
      queryFn: bridgeAwareQuery(() => successTurn('s', 'x')),
    })
    await live.dispose()
    await expect(live.sendTurn({ content: 'nope' })).rejects.toThrow(/closed/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('does not attribute late output from an aborted turn to the next turn', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cls-abort-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const queryFn: ClaudeQueryFn = ({ prompt }) =>
      (async function* () {
        let index = 0
        for await (const _user of prompt as AsyncIterable<SDKUserMessage>) {
          if (index++ === 0) {
            await gate
            yield { type: 'result', subtype: 'success', is_error: false, result: 'old' } as SDKMessage
          } else {
            yield { type: 'result', subtype: 'success', is_error: false, result: 'new' } as SDKMessage
          }
        }
      })() as ReturnType<ClaudeQueryFn>
    const live = ClaudeLiveSession.open({ cwd: dir, binaryPath: bin, queryFn })
    const firstController = new AbortController()
    const first = live.sendTurn({ content: 'first', signal: firstController.signal })
    await new Promise((resolve) => setTimeout(resolve, 10))
    firstController.abort()
    const second = live.sendTurn({ content: 'second' })
    release!()
    await expect(first).rejects.toThrow(/interrupted/)
    await expect(second).resolves.toMatchObject({ finalText: 'new' })
    await live.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  it('bridges Claude question and plan tools through the turn callbacks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cls-interactions-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    let canUseTool: any
    const queryFn: ClaudeQueryFn = ({ prompt, options }) =>
      (async function* () {
        for await (const _user of prompt as AsyncIterable<SDKUserMessage>) {
          canUseTool = options?.canUseTool
          await canUseTool('AskUserQuestion', { questions: [] }, { signal: new AbortController().signal, toolUseID: 'q1' })
          await canUseTool('ExitPlanMode', { plan: 'ship' }, { signal: new AbortController().signal, toolUseID: 'p1' })
          yield* successTurn('s', 'ok') as SDKMessage[]
        }
      })() as ReturnType<ClaudeQueryFn>
    const questions: unknown[] = []
    const plans: unknown[] = []
    const live = ClaudeLiveSession.open({ cwd: dir, binaryPath: bin, queryFn })
    await live.sendTurn({
      content: 'go',
      onQuestion: async (request) => {
        questions.push(request)
        return { answers: { Continue: 'Yes' } }
      },
      onPlan: async (request) => {
        plans.push(request)
        return { decision: 'approve' }
      },
    })
    expect(questions).toHaveLength(1)
    expect(plans).toHaveLength(1)
    await live.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
})
