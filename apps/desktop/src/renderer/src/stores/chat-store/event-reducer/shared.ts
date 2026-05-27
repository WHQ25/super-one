import type { ChatMessage } from '@superone/shared/agent-types'

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

/**
 * Patch the per-message `tool_use` block whose toolName is 'Agent' and whose
 * `toolUseId === tid`. Used by task_progress / task_notification reducers to
 * surface live taskUsage / taskSummary / taskToolHistory on the Agent block.
 */
export function _patchAgentBlock(
  messages: ChatMessage[],
  tid: string,
  patch: Record<string, unknown>,
): ChatMessage[] {
  return messages.map((msg) => ({
    ...msg,
    content: msg.content.map((block) =>
      block.type === 'tool_use' && block.toolName === 'Agent' && block.toolUseId === tid
        ? { ...block, ...patch }
        : block,
    ),
  }))
}
