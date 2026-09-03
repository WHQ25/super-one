import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'

// Re-exported from the shared package: the main-process session runtime seals on
// the same terminal events, and both sides must use one implementation.
export { sealCodexMetadata, sealStreamingTools } from '@superone/shared/content-delta'

/**
 * Tool names that we accumulate partial JSON for across `tool_input_delta`
 * events so we can extract a live preview before the tool actually runs.
 */
export const STREAMING_INPUT_TOOLS = new Set(['Edit', 'Write', 'FileChange', 'NotebookEdit'])

/** Minimum gap (ms) between live-preview extractions for one tool call. */
export const STREAMING_PREVIEW_THROTTLE_MS = 100

/**
 * Module-level accumulators shared between the content_delta and
 * tool_input_delta reducers. Keyed by `toolUseId`. Lifetime: from the first
 * partial-JSON delta until either the tool_result lands (content_delta side)
 * or the tool_use gets persisted (handled by `persistStreamingToolInput`).
 */
export const streamingToolInputRaw = new Map<string, string>()
export const streamingPreviewLastUpdate = new Map<string, number>()

/** Ownership of global Map entries — never clear by session without filtering on these keys. */
export const streamingToolInputOwners = new Map<string, { projectPath: string; sessionId: string }>()

export function noteStreamingToolInputOwner(
  toolUseId: string,
  projectPath: string | undefined,
  sessionId: string | undefined,
): void {
  if (!projectPath || !sessionId) return
  streamingToolInputOwners.set(toolUseId, { projectPath, sessionId })
}

/** Drop one tool's global streaming accumulators (safe for multi-session). */
export function clearStreamingToolInput(toolUseId: string): void {
  streamingToolInputRaw.delete(toolUseId)
  streamingPreviewLastUpdate.delete(toolUseId)
  streamingToolInputOwners.delete(toolUseId)
}

/** Drop global accumulators owned by one resolved session only. */
export function clearStreamingToolInputsForSession(projectPath: string, sessionId: string): void {
  for (const [toolUseId, owner] of streamingToolInputOwners) {
    if (owner.projectPath === projectPath && owner.sessionId === sessionId) {
      clearStreamingToolInput(toolUseId)
    }
  }
}

export function dropStreamingToolInputPreview(
  previews: Record<string, Record<string, unknown>>,
  toolUseId: string,
): Record<string, Record<string, unknown>> | undefined {
  if (!previews[toolUseId]) return undefined
  const { [toolUseId]: _, ...rest } = previews
  return rest
}

/** Terminal turns must not accept a late `status: 'streaming'` tool_use delta. */
export function isTerminalMessageStatus(status: ChatMessage['status'] | undefined): boolean {
  return status === 'interrupted' || status === 'error' || status === 'complete'
}

/**
 * Map messages with structural sharing: only clone a message when one of its
 * content blocks is replaced (by reference); only allocate a new messages array
 * when any message changed. Returns the original `messages` ref when nothing
 * matched — keeps React.memo(ChatMessage) working for non-target rows.
 *
 * `mapBlock` must return the same block reference when it does not change.
 */
export function mapMessagesStructural(
  messages: ChatMessage[],
  mapBlock: (block: ContentBlock, msg: ChatMessage) => ContentBlock,
): ChatMessage[] {
  let anyMsgChanged = false
  const next = messages.map((msg) => {
    let anyBlockChanged = false
    const content = msg.content.map((block) => {
      const nextBlock = mapBlock(block, msg)
      if (nextBlock !== block) anyBlockChanged = true
      return nextBlock
    })
    if (!anyBlockChanged) return msg
    anyMsgChanged = true
    return { ...msg, content }
  })
  return anyMsgChanged ? next : messages
}

/** Tool names that host progressive task_* events (Agent/Task subagents + Workflow). */
const TASK_PROGRESS_TOOL_NAMES = new Set(['Agent', 'Task', 'Workflow'])

/**
 * Patch the per-message `tool_use` block whose toolName is Agent/Task/Workflow and whose
 * `toolUseId === tid`. Used by task_progress / task_notification reducers to
 * surface live taskUsage / taskSummary / taskToolHistory on the launch block.
 */
export function _patchAgentBlock(
  messages: ChatMessage[],
  tid: string,
  patch: Record<string, unknown>,
): ChatMessage[] {
  return _patchTaskToolBlock(messages, tid, patch)
}

/**
 * Patch Agent or Workflow tool_use blocks (and optional matching tool_result
 * outputPath when present in patch as `_resultOutputPath` — not used; call
 * sites patch tool_result separately).
 */
export function _patchTaskToolBlock(
  messages: ChatMessage[],
  tid: string,
  patch: Record<string, unknown>,
): ChatMessage[] {
  return mapMessagesStructural(messages, (block) => {
    if (
      block.type === 'tool_use'
      && TASK_PROGRESS_TOOL_NAMES.has(block.toolName)
      && block.toolUseId === tid
    ) {
      return { ...block, ...patch }
    }
    return block
  })
}
