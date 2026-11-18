import type { PermissionMode } from '@superone/shared/agent-types'
import { parseMcpToolName, SUPERONE_KNOWN_MCP_BARE_TOOLS } from '@superone/shared/tool-ui'
import type { ParentWakeupProgress } from './antigravity-subagent-transcript'

export interface WakeupReplayContext {
  emittedWakeupToolUseIds?: Set<string>
  emittedWakeupToolResultIds: Set<string>
  replayedBackgroundToolIds: Set<string>
  unflushedWakeupReplay: boolean
  stalledWakeupToolReplay: boolean
  unlockedPostStallStream: boolean
  streamedPreUserPostStall: boolean
  wireWakeupStreamed?: boolean
  emittedWakeupThinkingText?: string
  emittedWakeupMessageText?: string
}

const NON_INTERACTIVE_WAKEUP_TOOLS = new Set([
  'read_file', 'view_file', 'view_file_outline', 'view_code_item', 'read_notebook',
  'grep_search', 'find_by_name', 'list_dir', 'search_web', 'read_url_content',
  'manage_task', 'manage_subagents', 'manage_inbox', 'schedule', 'define_subagent',
  'send_message', 'list_resources', 'read_resource', 'command_status', 'task_output',
  'wait', 'wait_5_seconds', 'swarm',
])

const ACCEPT_EDITS_MUTATION_TOOLS = new Set([
  'write_file', 'write_to_file', 'create_file', 'edit_file',
  'replace_file_content', 'multi_replace_file_content', 'edit_notebook', 'notebook_edit',
])

function isMcpWakeupTool(rawName: string | undefined, mappedName: string | undefined): boolean {
  if (!rawName) return false
  if (rawName === 'call_mcp_tool' || rawName.startsWith('mcp__') || SUPERONE_KNOWN_MCP_BARE_TOOLS.has(rawName)) {
    return true
  }
  if (parseMcpToolName(rawName)) return true
  return Boolean(mappedName && parseMcpToolName(mappedName))
}

export function resolveWakeupStallTimeoutMs(
  wakeup: ParentWakeupProgress,
  profile: 'standard' | 'auto' | 'bypass',
  interactionStallTimeoutMs: number,
  wakeupResponseTimeoutMs: number,
  hasExplicitStallTimeout: boolean,
  permissionMode?: PermissionMode | null,
): number {
  const rawName = wakeup.pendingToolRawName
  if (rawName === 'ask_question' || wakeup.pendingToolName === 'AskUserQuestion') {
    return interactionStallTimeoutMs
  }
  if (profile === 'bypass') return wakeupResponseTimeoutMs
  if (profile === 'auto') {
    if (rawName === 'run_command' && wakeup.pendingToolBypassSandbox) return interactionStallTimeoutMs
    return wakeupResponseTimeoutMs
  }
  if (!hasExplicitStallTimeout) {
    if (isMcpWakeupTool(rawName, wakeup.pendingToolName)) return wakeupResponseTimeoutMs
    if (rawName && NON_INTERACTIVE_WAKEUP_TOOLS.has(rawName)) return wakeupResponseTimeoutMs
    if (permissionMode === 'acceptEdits' && rawName && ACCEPT_EDITS_MUTATION_TOOLS.has(rawName)) {
      return wakeupResponseTimeoutMs
    }
  }
  if (hasExplicitStallTimeout || rawName !== 'run_command' || wakeup.pendingToolBypassSandbox) {
    return interactionStallTimeoutMs
  }
  return Math.max(interactionStallTimeoutMs, (wakeup.pendingToolWaitMs ?? 1_500) + 2_000)
}

function extractReplayChunkText(update: { content?: unknown }): string {
  const c = update.content as { type?: unknown; text?: unknown } | undefined
  return c?.type === 'text' && typeof c.text === 'string' ? c.text.trim() : ''
}

export function evaluateWakeupReplayDrop(
  ctx: WakeupReplayContext | undefined,
  update: { sessionUpdate: string; toolCallId?: string; content?: unknown },
): boolean {
  if (!ctx?.unflushedWakeupReplay) return false
  const kind = update.sessionUpdate
  if (
    kind !== 'agent_thought_chunk' &&
    kind !== 'agent_message_chunk' &&
    kind !== 'tool_call' &&
    kind !== 'tool_call_update' &&
    kind !== 'usage_update'
  ) {
    return false
  }
  if (!ctx.stalledWakeupToolReplay) {
    if (kind === 'tool_call' || kind === 'tool_call_update') {
      const id = typeof update.toolCallId === 'string' ? update.toolCallId : ''
      if (
        id &&
        !ctx.emittedWakeupToolUseIds?.has(id) &&
        !ctx.emittedWakeupToolResultIds.has(id) &&
        !ctx.replayedBackgroundToolIds.has(id)
      ) {
        resetWakeupReplayState(ctx)
        return false
      }
      return true
    }
    if (kind === 'agent_thought_chunk' || kind === 'agent_message_chunk') {
      const text = extractReplayChunkText(update)
      const recorded =
        kind === 'agent_thought_chunk'
          ? (ctx.emittedWakeupThinkingText ?? '')
          : (ctx.emittedWakeupMessageText ?? '')
      if (text && !recorded.includes(text)) {
        resetWakeupReplayState(ctx)
        return false
      }
      return true
    }
    return true
  }
  if (kind === 'tool_call' || kind === 'tool_call_update') {
    const id = typeof update.toolCallId === 'string' ? update.toolCallId : ''
    if (id && (ctx.emittedWakeupToolResultIds.has(id) || ctx.replayedBackgroundToolIds.has(id))) {
      return true
    }
    ctx.unlockedPostStallStream = true
    return false
  }
  if (!ctx.unlockedPostStallStream) return true
  ctx.streamedPreUserPostStall = true
  return false
}

export function resetWakeupReplayState(ctx: WakeupReplayContext | undefined): boolean {
  if (!ctx) return false
  const streamedPostStall = ctx.streamedPreUserPostStall
  ctx.unflushedWakeupReplay = false
  ctx.stalledWakeupToolReplay = false
  ctx.unlockedPostStallStream = false
  ctx.streamedPreUserPostStall = false
  ctx.wireWakeupStreamed = false
  ctx.emittedWakeupThinkingText = undefined
  ctx.emittedWakeupMessageText = undefined
  ctx.replayedBackgroundToolIds.clear()
  return streamedPostStall
}
