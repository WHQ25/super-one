import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ClaudeQueryFn } from '@superone/claude'
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { sendDeliveryHarness } from '@superone/runtime/session/send-delivery.test-support'
import { createNodeClaudeTurnRunner } from './claude-turn-runner'

/** An SDK query that answers each pushed prompt, or fails it once it ran when `failRun` is set. */
function scriptedQuery(script: { modelSwitchFails: boolean; failRun: boolean; prompts: string[] }): ClaudeQueryFn {
  return (({ prompt }: { prompt: AsyncIterable<SDKUserMessage> }) => {
    const iterator = (async function* () {
      for await (const user of prompt) {
        script.prompts.push(String(user.message?.content))
        if (script.failRun) {
          yield { type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 's-1', errors: ['tool crashed'] } as unknown as SDKMessage
          continue
        }
        yield { type: 'stream_event', session_id: 's-1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'done' } } } as unknown as SDKMessage
        yield { type: 'result', subtype: 'success', is_error: false, session_id: 's-1', result: 'done' } as unknown as SDKMessage
      }
    })()
    // A full SDK Query shape (`mcpServerStatus` marks it), so control calls reach it.
    return Object.assign(iterator, {
      mcpServerStatus: async () => [],
      setModel: async () => { if (script.modelSwitchFails) throw new Error('Claude process is not connected') },
    })
  }) as unknown as ClaudeQueryFn
}

describe('Claude runner input delivery', () => {
  const dirs: string[] = []
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

  const harness = (script: Parameters<typeof scriptedQuery>[0]) => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-delivery-'))
    dirs.push(dir)
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    const runner = createNodeClaudeTurnRunner({ binaryPath: bin, resolveProjectPath: () => dir, queryFn: scriptedQuery(script), allowSimulatedFallback: false })
    return { ...sendDeliveryHarness(runner, 'claude', dir), dispose: () => runner.disposeAll?.() }
  }

  it('keeps a message that failed before reaching the SDK retryable, and runs its resend', async () => {
    const script = { modelSwitchFails: false, failRun: false, prompts: [] as string[] }
    const h = harness(script)
    await h.send('u0', { text: 'warm up' })
    // The model switch for this turn fails before its prompt is pushed.
    script.modelSwitchFails = true
    const failed = await h.send('u1', { model: 'claude-opus-4-1' })
    expect(script.prompts).toHaveLength(1)
    expect(failed.status).toBe('idle')
    expect(h.failureOf(failed, 'u1')?.error).toMatch(/not connected/)

    script.modelSwitchFails = false
    const answered = await h.send('u1', { model: 'claude-opus-4-1' })
    expect(script.prompts).toHaveLength(2)
    expect(h.failureOf(answered, 'u1')).toBeUndefined()
    expect(h.lastAssistantText(answered)).toBe('done')
    await h.dispose()
  })

  it('holds a message whose prompt the SDK took before the turn failed', async () => {
    const script = { modelSwitchFails: false, failRun: true, prompts: [] as string[] }
    const h = harness(script)
    const failed = await h.send('u1')
    expect(failed.status).toBe('error')
    expect(h.failureOf(failed, 'u1')).toBeUndefined()

    script.failRun = false
    await h.send('u1')
    expect(script.prompts).toHaveLength(1)
    await h.dispose()
  })
})
