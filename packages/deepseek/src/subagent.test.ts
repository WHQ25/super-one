import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AgentEvent } from '@superone/shared/agent-types'
import { DeepseekRuntime } from './runtime'
import type { DeepseekToolPermissionRequest, ToolApprovalDecision } from './tool-plane'
import { TEST_PRESET_OPTIONS } from './test-presets'

const CHILD_MARKER = 'WRITE-THE-FILE'
const CHILD_FILE = 'from-the-child.txt'
const CHILD_TEXT = 'the child wrote this'

/** Said in the parent's first, completed turn — only a fork child can see it. */
const SECRET = 'xyzzy'
const RECALL_MARKER = 'RECALL-THE-SECRET'

/**
 * Two-agent script. The parent delegates once; the child writes one file and
 * answers. Which agent is speaking is read off the transcript rather than
 * tracked, because both run through the same adapter instance.
 */
class DelegatingAdapter extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const transcript = JSON.stringify(options.messages)
    const closing = transcript.includes('"tool-result"')

    if (!closing && transcript.includes(CHILD_MARKER)) {
      yield* toolCall('write', { file_path: CHILD_FILE, content: CHILD_TEXT })
      return
    }
    // A fork child sees the parent's completed turns but never the in-flight
    // one, so it reads the secret and not the instruction that delegated it.
    if (!closing && transcript.includes(RECALL_MARKER) && !transcript.includes('FORK-DELEGATE')) {
      const content = transcript.includes(SECRET) ? 'inherited' : 'blank'
      yield* toolCall('write', { file_path: CHILD_FILE, content })
      return
    }
    if (!closing && transcript.includes('FORK-DELEGATE')) {
      yield* toolCall('subagent_fork', { description: 'recall the secret', prompt: RECALL_MARKER })
      return
    }
    if (!closing && transcript.includes('DELEGATE')) {
      yield* toolCall('subagent', { description: 'write one file', prompt: CHILD_MARKER })
      return
    }
    yield* finalText(transcript.includes(CHILD_MARKER) ? 'child done' : 'parent done')
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

function* toolCall(name: string, args: Record<string, unknown>): Generator<StreamChunk> {
  const id = `call-${randomUUID().slice(0, 8)}` as never
  const encoded = JSON.stringify(args)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: encoded }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: encoded } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

function* finalText(text: string): Generator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

const dirs: string[] = []
const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  while (disposers.length) await disposers.pop()?.().catch(() => undefined)
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

async function delegateOnce(
  decide: () => ToolApprovalDecision,
  prompts: readonly string[] = ['DELEGATE the work'],
) {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-subagent-'))
  dirs.push(cwd)

  const runtime = await DeepseekRuntime.create({ ...TEST_PRESET_OPTIONS, persona: 'test agent' })
  disposers.push(() => runtime.dispose())
  ;(runtime.context as unknown as {
    llm: { registerAdapter(providers: string[], adapter: LlmAdapter): void }
  }).llm.registerAdapter(['mock'], new DelegatingAdapter())

  const asked: DeepseekToolPermissionRequest[] = []
  const ask = vi.fn(async (request: DeepseekToolPermissionRequest) => {
    asked.push(request)
    return decide()
  })

  const sessionId = randomUUID()
  const events: AgentEvent[] = []
  const agent = await runtime.createAgent({
    sessionId,
    cwd,
    provider: 'mock',
    model: 'mock-1',
    onEvent: (event) => events.push(event),
    toolPlane: { requestPermission: ask },
  })
  disposers.push(() => agent.dispose())

  for (const prompt of prompts) {
    agent.sendText(prompt)
    await new Promise((resolve) => setTimeout(resolve, 50))
    await agent.whenIdle()
  }

  return { cwd, sessionId, events, asked, ask }
}

function blocks(events: AgentEvent[]): Array<{ messageId: string; delta: Record<string, unknown> }> {
  return events.flatMap((event) => event.type === 'content_delta'
    ? [{ messageId: event.messageId, delta: event.delta as unknown as Record<string, unknown> }]
    : [])
}

function toolUse(events: AgentEvent[], toolName: string) {
  return blocks(events).find((b) => b.delta.type === 'tool_use' && b.delta.toolName === toolName)
}

function toolResults(events: AgentEvent[]): string {
  return events
    .filter((event) => event.type === 'content_delta' && event.delta.type === 'tool_result')
    .map((event) => JSON.stringify(event.type === 'content_delta' ? event.delta : {}))
    .join('\n')
}

describe('deepseek subagents', () => {
  /**
   * The reason the tool plane moved to the host plane. dsh composes a child by
   * joining its parent's *preset* composition, and this deployment runs no
   * preset roster — so anything registered on the parent's agent scope is
   * invisible to the child. If `write` were still mounted per agent, the child
   * would reach the model with an empty tool registry and this file would never
   * appear.
   */
  it('gives a delegated child the host tool plane, rooted in the parent workspace', async () => {
    const { cwd, events } = await delegateOnce(() => 'allowed-once')

    expect(readFileSync(join(cwd, CHILD_FILE), 'utf8')).toBe(CHILD_TEXT)
    expect(toolResults(events)).toContain('child done')
  })

  /**
   * The other half of that move: a gate installed on the parent's agent scope
   * never sees the child's calls, so the child would have written that file
   * with no prompt at all.
   */
  it('routes a child tool call to the parent answerer, tagged with the child session', async () => {
    const { sessionId, asked } = await delegateOnce(() => 'allowed-once')

    const write = asked.find((request) => request.toolName === 'write')
    expect(write).toBeDefined()
    expect(write?.input).toMatchObject({ file_path: CHILD_FILE })
    // Delegating is not itself an effect — every effect it causes is gated
    // under the child's own call, so `subagent` must not have asked as well.
    expect(asked.map((request) => request.toolName)).not.toContain('subagent')
    // Attributable to the child, answered by the parent.
    expect(write?.agentSessionId).toBeDefined()
    expect(write?.agentSessionId).not.toBe(sessionId)
  })

  /**
   * The second provider exists because one `tool-subagent` instance binds one
   * provider to one tool name. Fork's whole difference from spawn is the seed:
   * the parent's completed turns, never the in-flight one.
   */
  it('seeds a subagent_fork child with the parent completed turns', async () => {
    const { cwd, events } = await delegateOnce(() => 'allowed-once', [
      `REMEMBER the secret is ${SECRET}`,
      'FORK-DELEGATE the recall',
    ])

    expect(readFileSync(join(cwd, CHILD_FILE), 'utf8')).toBe('inherited')
    // Both delegation tools land in the same Task block.
    expect(toolUse(events, 'Task')?.delta.toolName).toBe('Task')
    expect(events.some((event) => event.type === 'task_started')).toBe(true)
  })

  it('performs no child effect when the user rejects', async () => {
    const { cwd, asked } = await delegateOnce(() => 'rejected')

    expect(asked.some((request) => request.toolName === 'write')).toBe(true)
    expect(existsSync(join(cwd, CHILD_FILE))).toBe(false)
  })
})

describe('deepseek subagent Task block', () => {
  /**
   * `isSubagentToolName()` matches `Agent`/`Task` exactly; under dsh's own name
   * the delegation would render as a generic tool row and collect nothing.
   */
  it('renames the delegation call to Task', async () => {
    const { events } = await delegateOnce(() => 'allowed-once')

    expect(toolUse(events, 'Task')).toBeDefined()
    expect(toolUse(events, 'subagent')).toBeUndefined()
  })

  it('opens and closes a task keyed on the delegation call id', async () => {
    const { events } = await delegateOnce(() => 'allowed-once')

    const task = toolUse(events, 'Task')
    const started = events.find((event) => event.type === 'task_started')
    const finished = events.find((event) => event.type === 'task_notification')

    expect(started).toMatchObject({
      toolUseId: task?.delta.toolUseId,
      description: 'write one file',
    })
    expect(finished).toMatchObject({
      toolUseId: task?.delta.toolUseId,
      taskStatus: 'completed',
    })
    // Same run id on both edges — that pairing is dsh's own contract.
    expect(started?.type === 'task_started' && started.taskId)
      .toBe(finished?.type === 'task_notification' && finished.taskId)
  })

  /**
   * The renderer rebuilds the subagent subtree from `parentToolUseId` stamps
   * within ONE message's content, so a child block addressed to a message of
   * its own would leak out of the Task block as top-level output.
   */
  it('attaches child blocks to the parent message under the delegation call', async () => {
    const { events } = await delegateOnce(() => 'allowed-once')

    const task = toolUse(events, 'Task')
    const childWrite = toolUse(events, 'Write')
    expect(childWrite).toBeDefined()
    expect(childWrite?.delta.parentToolUseId).toBe(task?.delta.toolUseId)
    expect(childWrite?.messageId).toBe(task?.messageId)
  })

  it('publishes no message and no todo panel update for the child', async () => {
    const { events } = await delegateOnce(() => 'allowed-once')

    const messageIds = new Set(
      events.flatMap((event) => event.type === 'message_start' ? [event.message.id] : []),
    )
    const task = toolUse(events, 'Task')
    expect(messageIds).toContain(task?.messageId)
    // The child runs its own turns and steps; none of them may become a
    // sibling assistant message in the parent's transcript.
    expect(messageIds.size).toBe(
      new Set(blocks(events).map((b) => b.messageId)).size,
    )
    expect(events.some((event) => event.type === 'todos_updated')).toBe(false)
  })
})
