/**
 * Codex thread items → shared content blocks.
 *
 * Codex streams typed thread items (`CodexThreadItem`); every other harness,
 * and every chat surface, speaks `ContentBlock`. This module is the one place
 * that translates between them: producers stream through
 * {@link createCodexContentStream}, and legacy items (stored rows, older hosts
 * and nodes, provider thread history) are projected with
 * {@link codexItemsToContent}. Reducing the stream's deltas with
 * `applyContentDelta` yields the projection of the final items.
 */
import type {
  CodexCollabAgentState,
  CodexCollabToolCallItem,
  CodexMcpToolCallItem,
  CodexThreadItem,
  ContentBlock,
} from './agent-types'
import { isCodexCommandToolError } from './codex-command-status'

type Parent = string | null
type ToolCall = Extract<ContentBlock, { type: 'tool_use' }>
type ToolResult = Extract<ContentBlock, { type: 'tool_result' }>

/** The hidden call a `todo_list` item becomes: the same carrier as Claude's todo tool. */
export const CODEX_TODO_TOOL = 'TodoWrite'
/** A native image generation; the turn-end gallery draws it, its row stays hidden. */
export const CODEX_IMAGE_GENERATION_TOOL = 'ImageGeneration'
/** A collab `wait`: shown while it runs, hidden once it has a result. */
export const CODEX_AGENT_WAIT_TOOL = 'AgentWait'

export const CODEX_FILE_CHANGE_FAILED = 'Failed to apply file changes.'

function safeStringify(value: unknown): string {
  try { return JSON.stringify(value) } catch { return String(value) }
}

export function codexMcpItemResultText(item: CodexMcpToolCallItem): string | undefined {
  const chunks: string[] = []
  if (item.result) {
    const contentArr = item.result.content as Array<{ type: string; text: string }> | undefined
    const textParts = contentArr?.filter((c) => c.type === 'text').map((c) => c.text)
    chunks.push(textParts?.length ? textParts.join('\n') : safeStringify(item.result))
  }
  if (item.error) chunks.push(`Error: ${item.error.message}`)
  const text = chunks.join('\n\n').trim()
  return text.length > 0 ? text : undefined
}

/** The call's input as a tool row reads it. String arguments are the serialized input already. */
export function codexMcpItemInput(item: CodexMcpToolCallItem): string {
  return typeof item.arguments === 'string' ? item.arguments : safeStringify(item.arguments ?? {})
}

/** The server rejected the call for missing sign-in (not a user deny). */
export function hasCodexMcpAuthChallenge(item: CodexMcpToolCallItem): boolean {
  if (item.authRequired) return true
  const meta = item.result?.meta
  return Boolean(meta && (meta['mcp/www_authenticate'] ?? meta.mcpWwwAuthenticate))
}

/** A tool's own error reply completes the call with a flagged result, so the status alone misses it. */
export function codexMcpItemIsError(item: CodexMcpToolCallItem): boolean {
  return item.status === 'failed' || Boolean(item.error) || item.result?.isError === true
}

function call(
  item: { id: string; remoteDetail?: string },
  toolName: string,
  input: Record<string, unknown> | string,
  running: boolean,
  parentToolUseId: Parent,
  extra: Partial<ToolCall> = {},
): ToolCall {
  return {
    type: 'tool_use',
    toolName,
    toolUseId: item.id,
    input: typeof input === 'string' ? input : JSON.stringify(input),
    status: running ? 'streaming' : 'complete',
    parentToolUseId,
    ...extra,
    ...(item.remoteDetail ? { remoteDetail: item.remoteDetail } : {}),
  }
}

function result(toolUseId: string, summary: string, parentToolUseId: Parent, extra: Partial<ToolResult> = {}): ToolResult {
  return { type: 'tool_result', toolUseId, summary, parentToolUseId, ...extra }
}

/** Terminal lifecycle of a collab agent, in the shared subagent vocabulary (no value while it runs). */
function agentTaskStatus(state: CodexCollabAgentState | undefined): 'completed' | 'failed' | 'stopped' | undefined {
  switch (state?.status) {
    case 'completed': return 'completed'
    case 'errored': return 'failed'
    case 'shutdown':
    case 'notFound': return 'stopped'
    default: return undefined
  }
}

function collabAgentBlocks(item: CodexCollabToolCallItem, parentToolUseId: Parent): ContentBlock[] {
  const threadId = item.receiverThreadIds[0]!
  const state = item.agentsStates[threadId]
  const taskStatus = agentTaskStatus(state)
  const running = item.status === 'in_progress' || state?.status === 'running' || state?.status === 'pendingInit'
  // The role is the card's badge (`subagent_type`); the nickname names the agent.
  const description = state?.nickname
  const container = call(item, 'Agent', {
    ...(item.prompt ? { prompt: item.prompt } : {}),
    ...(description ? { description } : {}),
    ...(state?.role ? { subagent_type: state.role } : {}),
    ...(item.tool !== 'spawnAgent' ? { followUp: true } : {}),
  }, running, parentToolUseId, {
    taskThreadId: threadId,
    ...(description ? { taskDescription: description } : {}),
    ...(taskStatus ? { taskStatus } : {}),
    ...(state?.message ? { taskResultText: state.message } : {}),
    ...(state?.tokens ? { taskUsage: { totalTokens: state.tokens.input + state.tokens.output, toolUses: 0, durationMs: 0 } } : {}),
    // The original Codex state stays readable for diagnostics and status copy.
    ...(state ? { taskSummary: state.status } : {}),
  })
  const children = Object.values(item.childItems ?? {}).flatMap(items => items.flatMap(child => codexItemToBlocks(child, item.id)))
  // A finished agent answers its card, which is what completes a card without live task events.
  const outcome = taskStatus ? [result(item.id, state?.message ?? '', parentToolUseId, taskStatus === 'failed' ? { isError: true } : {})] : []
  return [container, ...children, ...outcome]
}

/**
 * The content blocks one Codex item draws, with deterministic ids.
 * `parentToolUseId` scopes a collab child's blocks under its agent card.
 */
export function codexItemToBlocks(item: CodexThreadItem, parentToolUseId: Parent = null): ContentBlock[] {
  const remote = 'remoteDetail' in item && item.remoteDetail ? { remoteDetail: item.remoteDetail } : {}
  switch (item.type) {
    case 'agent_message':
      if (!item.text && !item.questions?.length) return []
      return [{ type: 'text', id: item.id, text: item.text, parentToolUseId, ...(item.questions?.length ? { codexAsyncQuestions: item.questions } : {}) }]
    case 'reasoning':
      return [{ type: 'thinking', id: item.id, thinking: item.text, parentToolUseId,
        ...(item.startedAt !== undefined ? { startedAt: item.startedAt } : {}),
        ...(item.endedAt !== undefined ? { endedAt: item.endedAt } : {}), ...remote }]
    case 'plan':
      return [{ type: 'plan', id: item.id, text: item.text, parentToolUseId }]
    case 'command_execution': {
      const running = item.status === 'in_progress'
      const input = { command: item.command, ...(item.cwd ? { cwd: item.cwd } : {}), ...(item.commandActions?.length ? { commandActions: item.commandActions } : {}) }
      if (running) return [call(item, 'Bash', input, true, parentToolUseId, item.aggregatedOutput ? { liveOutput: item.aggregatedOutput } : {})]
      return [
        call(item, 'Bash', input, false, parentToolUseId),
        result(item.id, item.aggregatedOutput ?? '', parentToolUseId, {
          ...(item.exitCode !== undefined ? { exitCode: item.exitCode } : {}),
          ...(isCodexCommandToolError(item) ? { isError: true } : {}),
        }),
      ]
    }
    case 'file_change': {
      const failed = item.status === 'failed'
      // A failed patch with no parsed changes still owes the user its error row.
      const changes = item.changes.length ? item.changes : [null]
      return changes.flatMap((change, index): ContentBlock[] => {
        const toolUseId = `${item.id}:${index}`
        const tool = call({ id: toolUseId, ...remote }, 'FileChange',
          change ? { file_path: change.path, kind: change.kind, diff: change.diff ?? '' } : {}, false, parentToolUseId,
          change?.toolLineDelta ? { toolLineDelta: change.toolLineDelta } : {})
        return failed ? [tool, result(toolUseId, index === 0 ? CODEX_FILE_CHANGE_FAILED : '', parentToolUseId, { isError: true })] : [tool]
      })
    }
    case 'mcp_tool_call': {
      const running = item.status === 'in_progress'
      const tool = call(item, `mcp__${item.server}__${item.tool}`, codexMcpItemInput(item), running, parentToolUseId, {
        ...(item.app ? { app: item.app } : {}),
        ...(item.suggestedTask ? { suggestedTask: item.suggestedTask } : {}),
        ...(hasCodexMcpAuthChallenge(item) ? { authRequired: true } : {}),
      })
      if (running) return [tool]
      return [tool, result(item.id, codexMcpItemResultText(item) ?? '', parentToolUseId, codexMcpItemIsError(item) ? { isError: true } : {})]
    }
    case 'web_search': {
      const tool = call(item, 'WebSearch', { query: item.query }, item.status === 'in_progress', parentToolUseId)
      return item.status === 'failed' ? [tool, result(item.id, '', parentToolUseId, { isError: true })] : [tool]
    }
    case 'todo_list':
      return [call(item, CODEX_TODO_TOOL, {
        todos: item.items.map(entry => ({ content: entry.text, status: entry.completed ? 'completed' : 'pending', activeForm: entry.text })),
      }, false, parentToolUseId)]
    case 'error':
      return [{ type: 'notice', id: item.id, level: 'error', text: item.message, parentToolUseId }]
    case 'review':
      return [{ type: 'review', id: item.id, phase: item.phase, text: item.text, parentToolUseId }]
    case 'compaction':
      return [{ type: 'notice', id: item.id, level: 'info', kind: 'compaction', text: '', parentToolUseId }]
    case 'image_generation': {
      const { id: _id, type: _type, ...generation } = item
      // Status rides in the input: a generation outlives its turn, so the
      // terminal seal must not be able to freeze it.
      return [call(item, CODEX_IMAGE_GENERATION_TOOL, generation, false, parentToolUseId)]
    }
    case 'collab_tool_call':
      switch (item.tool) {
        case 'spawnAgent':
          return item.receiverThreadIds.length ? collabAgentBlocks(item, parentToolUseId) : []
        case 'sendInput':
          return item.receiverThreadIds.length
            ? collabAgentBlocks(item, parentToolUseId)
            : [call(item, 'SendMessage', { message: item.prompt ?? '' }, item.status === 'in_progress', parentToolUseId)]
        case 'wait': {
          const waiting = call(item, CODEX_AGENT_WAIT_TOOL, { agents: item.receiverThreadIds }, item.status === 'in_progress', parentToolUseId)
          return item.status === 'in_progress' ? [waiting] : [waiting, result(item.id, item.status, parentToolUseId)]
        }
        // Closing or resuming an agent is bookkeeping; the agent card already shows its state.
        case 'closeAgent':
        case 'resumeAgent':
          return []
      }
      return []
    // A widget payload, never a Codex turn item.
    case 'video_generation':
      return []
  }
}

/**
 * Project a turn's items. `cache` keeps each unchanged item's blocks, so a
 * legacy stream re-projects only the item its delta touched.
 */
export function codexItemsToContent(
  items: readonly CodexThreadItem[],
  cache?: WeakMap<CodexThreadItem, ContentBlock[]>,
): ContentBlock[] {
  return items.flatMap((item) => {
    const cached = cache?.get(item)
    if (cached) return cached
    const blocks = codexItemToBlocks(item)
    cache?.set(item, blocks)
    return blocks
  })
}

/** One `content_delta` payload. */
export interface CodexContentDelta {
  delta: ContentBlock
  replace?: true
}

function blockKey(block: ContentBlock): string {
  const parent = 'parentToolUseId' in block ? block.parentToolUseId ?? '' : ''
  if ('toolName' in block) return `call\0${block.toolUseId}`
  if (block.type === 'tool_result') return `result\0${block.toolUseId}`
  return `${block.type}\0${parent}\0${'id' in block ? block.id : ''}`
}

function textOf(block: ContentBlock): string | undefined {
  return block.type === 'text' || block.type === 'plan' ? block.text : block.type === 'thinking' ? block.thinking : undefined
}

function withText(block: ContentBlock, text: string): ContentBlock {
  if (block.type === 'thinking') return { ...block, thinking: text }
  return { ...block, text } as ContentBlock
}

function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/** The delta(s) that move `prev` (if any) to `next` under `applyContentDelta`. */
function diffBlock(prev: ContentBlock | undefined, next: ContentBlock): CodexContentDelta[] {
  const nextText = textOf(next)
  if (nextText !== undefined) {
    if (!prev) return [{ delta: next }]
    const prevText = textOf(prev)!
    if (nextText.startsWith(prevText)) {
      const suffix = nextText.slice(prevText.length)
      const unchanged = suffix === '' && sameJson({ ...prev, text: '', thinking: '' }, { ...next, text: '', thinking: '' })
      return unchanged ? [] : [{ delta: withText(next, suffix) }]
    }
    return [{ delta: next, replace: true }]
  }
  if (next.type === 'tool_use') {
    const { liveOutput: nextOutput, ...nextCall } = next
    const prevCall = prev?.type === 'tool_use' ? prev : undefined
    const prevOutput = prevCall?.liveOutput ?? ''
    const { liveOutput: _prevOutput, ...prevRest } = prevCall ?? {}
    const changed = !prevCall || !sameJson(prevRest, nextCall)
    // A finished call carries its output in the result, which drops the preview.
    if (nextOutput === undefined || nextOutput === prevOutput) return changed ? [{ delta: nextCall }] : []
    const output = nextOutput
    if (output.startsWith(prevOutput)) return [{ delta: { ...nextCall, outputDelta: output.slice(prevOutput.length) } }]
    return [{ delta: { ...nextCall, outputDelta: output }, replace: true }]
  }
  // Results are appended by `applyContentDelta`, so each call gets exactly one.
  if (next.type === 'tool_result') return prev ? [] : [{ delta: next }]
  return prev && sameJson(prev, next) ? [] : [{ delta: next }]
}

export interface CodexContentStream {
  /** Deltas for one item's latest full state, as `codex_item_delta` used to carry it. */
  update(item: CodexThreadItem): CodexContentDelta[]
}

/**
 * Turn successive full-item snapshots into append-only content deltas. Text
 * that extends what was sent streams as a suffix; anything else replaces the
 * block by id.
 */
export function createCodexContentStream(): CodexContentStream {
  const sent = new Map<string, ContentBlock>()
  return {
    update(item) {
      const deltas: CodexContentDelta[] = []
      for (const block of codexItemToBlocks(item)) {
        const key = blockKey(block)
        const next = diffBlock(sent.get(key), block)
        if (next.length) sent.set(key, block)
        deltas.push(...next)
      }
      return deltas
    },
  }
}
