/**
 * Test support: a scripted model for driving dsh tools end to end.
 */

import { randomUUID } from 'node:crypto'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { DeepseekRuntime } from './runtime'

/**
 * Scripted adapter driven by sentinels in the prompt: `CALL <tool> <json>` emits
 * exactly that tool call, once, so a test states the call it wants instead of
 * depending on a real model's choice. Registered for the `mock` provider.
 */
export class ToolCallAdapter extends LlmAdapter {
  /** The tool results each request carried, oldest request first. */
  readonly toolResults: string[][] = []

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const transcript = JSON.stringify(options.messages)
    this.toolResults.push(options.messages.filter((m) => m.role === 'tool').map((m) => JSON.stringify(m.content)))
    const call = /CALL (\w+) (\{.*?\})(?=["\\])/.exec(transcript)
    // A tool result already in the transcript means this step closes the turn.
    if (!call || transcript.includes('"role":"tool"')) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'done' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const [, name, rawArgs] = call
    const args = rawArgs.replace(/\\"/g, '"')
    const id = `call-${randomUUID().slice(0, 8)}` as never
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }

  override providerInfo(provider: string) {
    return { id: provider, name: 'Mock' }
  }

  override async listModels(provider: string) {
    return [{ provider, id: 'mock-1', name: 'Mock One' }]
  }

  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: 'Mock One', context: { contextWindow: 4000 } }
  }
}

/**
 * Route the runtime's `mock` provider to a fresh scripted adapter.
 * @param runtime - the runtime under test.
 * @returns the adapter, for reading what the model was sent.
 */
export function useToolCallAdapter(runtime: DeepseekRuntime): ToolCallAdapter {
  const adapter = new ToolCallAdapter()
  ;(runtime.context as unknown as {
    llm: { registerAdapter(providers: string[], adapter: LlmAdapter): void }
  }).llm.registerAdapter(['mock'], adapter)
  return adapter
}
