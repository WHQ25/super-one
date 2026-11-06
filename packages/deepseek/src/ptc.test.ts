import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { DeepseekRuntime } from './runtime'
import { TEST_PRESET_OPTIONS } from './test-presets'
import type { DeepseekToolPermissionRequest } from './tool-plane'

/** One real Node program calling back through the PTC control channel. */
const PROGRAM = `
const read = await tools.read({ file_path: "note.txt" });
let denial = "";
try {
  await tools.write({ file_path: "blocked.txt", content: "must not be written" });
} catch (error) {
  denial = error.message;
}
return { read, denial };
`

class PtcAdapter extends LlmAdapter {
  readonly results: string[] = []
  readonly catalogs: string[][] = []

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.catalogs.push((options.tools ?? []).map((tool) => tool.name))
    const results = options.messages.filter((message) => message.role === 'tool')
    if (results.length === 0) {
      const id = `call-${randomUUID()}` as never
      const args = JSON.stringify({ code: PROGRAM, description: 'Read workspace and check denied write' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'run_code', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'run_code', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    this.results.push(JSON.stringify(results.map((result) => result.content)))
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'done' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }

  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: 'PTC fixture', context: { contextWindow: 200_000 } }
  }
}

const disposers: Array<() => Promise<void>> = []
const dirs: string[] = []

afterEach(async () => {
  while (disposers.length) await disposers.pop()?.()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('PTC Node integration', () => {
  it.each(['workspace-write', 'danger-full-access'] as const)('runs the configured Node bootstrap with %s and retains nested tool permissions', async (preset) => {
    const cwd = mkdtempSync(join(tmpdir(), 'dsh-ptc-'))
    dirs.push(cwd)
    writeFileSync(join(cwd, 'note.txt'), 'PTC fixture from the session workspace')
    const runtime = await DeepseekRuntime.create({
      ...TEST_PRESET_OPTIONS,
      // Exercise the host override, including its node-script launch config.
      ptcNodeExecutable: process.execPath,
    })
    disposers.push(() => runtime.dispose())
    const adapter = new PtcAdapter()
    runtime.context.llm.registerAdapter(['mock'], adapter)
    const confinement = vi.spyOn(runtime.context.get('sandbox')!, 'confine')
    const ask = vi.fn(async (request: DeepseekToolPermissionRequest) =>
      request.toolName === 'write' ? 'rejected' as const : 'allowed-once' as const,
    )
    const agent = await runtime.createAgent({
      sessionId: randomUUID(), cwd, provider: 'mock', model: 'mock-ptc',
      agentPreset: 'ptc', onEvent: () => {},
      toolPlane: { requestPermission: ask },
    })
    disposers.push(() => agent.dispose())
    runtime.setPermissionPreset(agent.sessionId, preset)

    agent.sendText('Run the program once')
    await vi.waitFor(() => expect(adapter.results).toHaveLength(1), { timeout: 15_000 })
    await agent.whenIdle()

    if (preset === 'workspace-write') {
      expect(confinement).toHaveBeenCalledWith(
        expect.arrayContaining([process.execPath]),
        expect.objectContaining({ mode: 'workspace-write', workspaceRoot: cwd }),
        expect.any(AbortSignal),
      )
    } else {
      expect(confinement).not.toHaveBeenCalled()
    }

    expect(adapter.catalogs[0]).toEqual(['run_code'])
    expect(adapter.results[0]).toContain('PTC fixture from the session workspace')
    expect(adapter.results[0]).toContain('the user rejected tool')
    expect(ask.mock.calls.map(([request]) => request.toolName)).toEqual(['run_code', 'write'])
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'write', input: { file_path: 'blocked.txt', content: 'must not be written' },
    }))
    expect(existsSync(join(cwd, 'blocked.txt'))).toBe(false)
  }, 20_000)
})
