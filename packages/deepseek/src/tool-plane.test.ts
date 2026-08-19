import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AgentEvent } from '@superone/shared/agent-types'
import { DeepseekRuntime } from './runtime'
import type { ToolApprovalDecision } from './tool-plane'

/**
 * Scripted adapter driven by sentinels in the prompt: `CALL <tool> <json>` emits
 * exactly that tool call, so a test states the call it wants instead of
 * depending on a real model's choice.
 */
class ToolCallAdapter extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const transcript = JSON.stringify(options.messages)
    const call = /CALL (\w+) (\{.*?\})(?=["\\])/.exec(transcript)
    // A tool result already in the transcript means this step closes the turn.
    if (!call || transcript.includes('"tool-result"')) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'done' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const [, name, rawArgs] = call
    const args = rawArgs.replace(/\\"/g, '"')
    const id = `call-${randomUUID().slice(0, 8)}`
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id: id as never, name, argumentsDelta: args }
    yield {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: id as never, name, arguments: args },
    }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }

  override providerInfo(provider: string) {
    return { id: provider, name: 'Mock' }
  }

  override async listModels(provider: string) {
    return [{ provider, id: 'mock-1', name: 'Mock One' }]
  }

  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: 'Mock One', context: { contextWindow: 1000 } }
  }
}

const dirs: string[] = []
const disposers: Array<() => Promise<void>> = []

function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tool-plane-'))
  dirs.push(dir)
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  return dir
}

async function bootRuntime() {
  const runtime = await DeepseekRuntime.create({ persona: 'test agent' })
  disposers.push(() => runtime.dispose())
  const ctx = runtime.context as unknown as {
    llm: { registerAdapter(providers: string[], adapter: LlmAdapter): void }
  }
  ctx.llm.registerAdapter(['mock'], new ToolCallAdapter())
  return runtime
}

async function startAgent(
  runtime: DeepseekRuntime,
  cwd: string,
  requestPermission: (request: { toolName: string }) => Promise<ToolApprovalDecision>,
) {
  const events: AgentEvent[] = []
  const agent = await runtime.createAgent({
    sessionId: randomUUID(),
    cwd,
    provider: 'mock',
    model: 'mock-1',
    onEvent: (event) => events.push(event),
    toolPlane: { requestPermission: requestPermission as never },
  })
  disposers.push(() => agent.dispose())
  return { agent, events }
}

async function runTurn(agent: { sendText(text: string): void; whenIdle(): Promise<void> }, text: string) {
  agent.sendText(text)
  await new Promise((resolve) => setTimeout(resolve, 50))
  await agent.whenIdle()
}

function toolResultText(events: AgentEvent[]): string {
  return events
    .filter((event) => event.type === 'content_delta' && event.delta.type === 'tool_result')
    .map((event) => JSON.stringify(event.type === 'content_delta' ? event.delta : {}))
    .join('\n')
}

afterEach(async () => {
  while (disposers.length) await disposers.pop()?.().catch(() => undefined)
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('deepseek tool plane', () => {
  it('runs read-only tools without a permission prompt', async () => {
    const runtime = await bootRuntime()
    const cwd = workspace({ 'note.txt': 'from the workspace' })
    const ask = vi.fn(async () => 'allowed-once' as const)
    const { agent, events } = await startAgent(runtime, cwd, ask)

    await runTurn(agent, 'CALL read {"file_path":"note.txt"}')

    expect(ask).not.toHaveBeenCalled()
    expect(toolResultText(events)).toContain('from the workspace')
  })

  it('parks a mutating tool on the permission answerer and passes its arguments', async () => {
    const runtime = await bootRuntime()
    const cwd = workspace({})
    const ask = vi.fn(async () => 'allowed-once' as const)
    const { agent } = await startAgent(runtime, cwd, ask)

    await runTurn(agent, 'CALL write {"file_path":"created.txt","content":"hello"}')

    expect(ask).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'write',
      input: expect.objectContaining({ file_path: 'created.txt', content: 'hello' }),
    }))
    expect(readFileSync(join(cwd, 'created.txt'), 'utf8')).toBe('hello')
  })

  it('performs no effect when the user rejects', async () => {
    const runtime = await bootRuntime()
    const cwd = workspace({})
    const ask = vi.fn(async () => 'rejected' as const)
    const { agent } = await startAgent(runtime, cwd, ask)

    await runTurn(agent, 'CALL write {"file_path":"rejected.txt","content":"nope"}')

    expect(ask).toHaveBeenCalled()
    expect(() => readFileSync(join(cwd, 'rejected.txt'), 'utf8')).toThrow()
  })

  // Two agents share one `ctx.fs` now that the executors sit on the host plane,
  // so this is the test that says the sharing is safe: dsh resolves the
  // workspace at the tool boundary from `session.header.cwd`, not from the
  // backend's mount-time `config.cwd`.
  it('keeps each session rooted in its own cwd', async () => {
    const runtime = await bootRuntime()
    const first = workspace({ 'shared-name.txt': 'first workspace' })
    const second = workspace({ 'shared-name.txt': 'second workspace' })
    const ask = vi.fn(async () => 'allowed-once' as const)
    const a = await startAgent(runtime, first, ask)
    const b = await startAgent(runtime, second, ask)

    await runTurn(a.agent, 'CALL read {"file_path":"shared-name.txt"}')
    await runTurn(b.agent, 'CALL read {"file_path":"shared-name.txt"}')

    expect(toolResultText(a.events)).toContain('first workspace')
    expect(toolResultText(b.events)).toContain('second workspace')
  })
})
