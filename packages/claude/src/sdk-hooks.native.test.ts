import { createServer } from 'node:http'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { query, type HookCallback } from '@anthropic-ai/claude-agent-sdk'
import { resolveSdkClaudeBinary } from './resolve-sdk-binary'

/** Opt-in real native protocol check; the API is local and no account is used. */
describe.skipIf(process.env.SUPERONE_TEST_CLAUDE_NATIVE !== '1')('Claude native authorization hook failures', () => {
  it.each(['throw', 'invalid-output'])('blocks a Write after %s and emits a warning', async failure => {
    const dir = mkdtempSync(join(tmpdir(), 'superone-claude-hook-'))
    const marker = join(dir, 'must-not-exist.txt')
    let calls = 0
    const server = createServer(async (req, res) => {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw)
      if (!Array.isArray(body.messages)) { res.end(JSON.stringify({ input_tokens: 12 })); return }
      const tool = calls++ === 0
      const block = tool ? { type: 'tool_use', id: 'toolu_guard', name: 'Write', input: { file_path: marker, content: 'must not run' } } : { type: 'text', text: 'done' }
      const stop = tool ? 'tool_use' : 'end_turn'
      const message = { id: `msg_fixture_${calls}`, type: 'message', role: 'assistant', model: body.model, content: [block], stop_reason: stop, usage: { input_tokens: 12, output_tokens: 5 } }
      if (!body.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(message)); return }
      res.setHeader('content-type', 'text/event-stream')
      const frames = [
        { type: 'message_start', message: { ...message, content: [], stop_reason: null } },
        { type: 'content_block_start', index: 0, content_block: tool ? { ...block, input: {} } : { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: tool ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: 'done' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } },
        { type: 'message_stop' },
      ]
      res.end(frames.map(frame => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join(''))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    const callback = vi.fn(async () => {
      if (failure === 'throw') throw new Error('fixture guard failed')
      return { hookSpecificOutput: { hookEventName: 'InvalidEvent' } }
    })
    const q = query({ prompt: 'Write the fixture marker once.', options: {
      cwd: dir, pathToClaudeCodeExecutable: resolveSdkClaudeBinary()!, settingSources: [],
      tools: ['Write'], maxTurns: 2, permissionMode: 'default',
      canUseTool: async () => ({ behavior: 'allow' }),
      hooks: { PreToolUse: [{ onFailure: 'block', hooks: [callback as HookCallback] }] },
      env: { ...process.env, ANTHROPIC_API_KEY: 'fixture-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
        ANTHROPIC_AUTH_TOKEN: '', CLAUDE_CODE_OAUTH_TOKEN: '', CLAUDE_CODE_SESSION_ACCESS_TOKEN: '',
        CLAUDE_CONFIG_DIR: dir, CLAUDE_SECURESTORAGE_CONFIG_DIR: dir,
        CLAUDE_CODE_USE_BEDROCK: '', CLAUDE_CODE_USE_VERTEX: '', CLAUDE_CODE_USE_FOUNDRY: '', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
    } })
    const messages: Array<Record<string, unknown>> = []
    try {
      for await (const message of q) messages.push(message)
      expect(callback).toHaveBeenCalledOnce()
      expect(existsSync(marker)).toBe(false)
      expect(messages).toContainEqual(expect.objectContaining({ type: 'system', subtype: 'informational', level: 'warning' }))
    } finally {
      q.close()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
