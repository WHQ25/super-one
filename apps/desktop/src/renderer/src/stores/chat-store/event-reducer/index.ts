import type { AgentEvent } from '@superone/shared/agent-types'
import type { PerSessionState } from '../types'
import { reduceCodex } from './codex'
import { reduceContentDelta } from './content'
import { reduceLifecycle } from './lifecycle'
import { reduceMessageComplete } from './message-complete'
import { reducePermission } from './permission'
import { reduceQuestionPlan } from './question-plan'
import { reduceSlash } from './slash'
import { reduceTool } from './tool'
import { reduceUsage } from './usage'

/**
 * Apply one AgentEvent to a session, returning a sparse patch (Partial<PerSessionState>).
 *
 * Pure function — no side effects on Zustand state. Reducers in `./event-reducer/*`
 * own their own event-type groups; this dispatcher delegates and falls through
 * to `{}` for events the renderer doesn't care about (hooks, auth, files, stream).
 */
export function applyEventToSession(session: PerSessionState, event: AgentEvent): Partial<PerSessionState> {
  switch (event.type) {
    case 'queued_message_consumed':
    case 'message_start':
    case 'user_message_appended':
    case 'message_interrupted':
    case 'message_error':
    case 'status_change':
    case 'session_init':
    case 'init_ready':
    case 'worktree_missing':
      return reduceLifecycle(session, event)

    case 'content_delta':
      return reduceContentDelta(session, event)

    case 'message_complete':
      return reduceMessageComplete(session, event)

    case 'tool_input_delta':
    case 'tool_progress':
    case 'subagent_usage':
    case 'task_started':
    case 'task_progress':
    case 'task_notification':
      return reduceTool(session, event)

    case 'permission_request':
    case 'permission_mode_change':
    case 'agent_setting_change':
    case 'interaction_resolved':
      return reducePermission(session, event)

    case 'ask_user_question':
    case 'plan_approval':
      return reduceQuestionPlan(session, event)

    case 'prompt_suggestion':
    case 'slash_command_output':
    case 'compact_boundary':
    case 'checkpoint_captured':
      return reduceSlash(session, event)

    case 'codex_thread_started':
    case 'codex_item_delta':
    case 'codex_mcp_startup':
      return reduceCodex(session, event)

    case 'message_usage':
    case 'status_indicator':
    case 'rate_limit':
    case 'api_retry':
      return reduceUsage(session, event)

    case 'hook_started':
    case 'hook_complete':
    case 'hook_progress':
    case 'auth_status':
    case 'files_persisted':
    case 'elicitation_complete':
    case 'stream_message_start':
    case 'stream_message_stop':
      return {}
  }
  return {}
}
