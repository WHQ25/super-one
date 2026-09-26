export interface SubagentRunFacts {
  /**
   * A task lifecycle (`task_started` … `task_notification`) owns this card. The
   * desktop knows from its `taskProgress` entry; the phone from the task facts
   * patched onto the block. A background launch is tracked by definition.
   */
  tracked: boolean
  /** The task lifecycle reached its terminal notification. */
  finished: boolean
  /** The launching tool call has its `tool_result`. */
  hasResult: boolean
  isStreaming: boolean
}

/**
 * Whether a subagent card is running, one rule for the desktop and the phone.
 * A tracked task is running until its notification lands: a background launch's
 * `tool_result` is only its receipt, and the run can outlive the turn — a nested
 * agent keeps working inside a background parent after the main turn went idle.
 * An untracked card follows its own tool call.
 */
export function subagentRunState({ tracked, finished, hasResult, isStreaming }: SubagentRunFacts): {
  isRunning: boolean
  isComplete: boolean
} {
  if (tracked) return { isRunning: !finished, isComplete: finished }
  return { isRunning: !hasResult && isStreaming, isComplete: hasResult }
}
