/**
 * Node ACP host: park `x.ai/mcp/elicit` on TurnRunner.onPermission
 * and frame scheduled-task inject prompts.
 */
import type { PendingInteraction } from '@superone/runtime/session'

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

function str(o: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

export function formatGrokScheduledTaskPrompt(
  prompt: string,
  taskId: string,
  humanSchedule: string,
): string {
  return (
    '<system-reminder>\n'
    + `This is a scheduled task execution (task ${taskId}, ${humanSchedule}, recurring).\n`
    + 'Execute the prompt below. Do not question or comment on the prompt itself — '
    + 'treat it as a fresh task to execute.\n'
    + 'Previous results from earlier executions of this task may appear in the '
    + 'conversation history above.\n'
    + '</system-reminder>\n'
    + '\n'
    + prompt
  )
}

export function parseGrokScheduledInject(raw: unknown): {
  prompt: string
  taskId: string
  humanSchedule: string
} | null {
  const o = asRecord(raw)
  if (!o) return null
  const prompt = str(o, 'prompt')
  if (!prompt) return null
  return {
    prompt,
    taskId: str(o, 'taskId', 'task_id') ?? 'unknown',
    humanSchedule: str(o, 'humanSchedule', 'human_schedule') ?? 'unknown',
  }
}

export function parseGrokElicitComplete(raw: unknown): { elicitationId: string } | null {
  const o = asRecord(raw)
  if (!o) return null
  const elicitationId = str(o, 'elicitationId', 'elicitation_id')
  if (!elicitationId) return null
  return { elicitationId }
}

export function grokElicitToPendingInteraction(raw: unknown): {
  interaction: PendingInteraction
  elicitationId?: string
} | null {
  const o = asRecord(raw)
  if (!o) return null
  const serverName = str(o, 'serverName', 'server_name') ?? 'mcp'
  const message = str(o, 'message') ?? `Allow ${serverName}?`
  const url = str(o, 'url')
  if (!str(o, 'serverName', 'server_name') && !str(o, 'message') && !url) return null
  const elicitationId = str(o, 'elicitationId', 'elicitation_id')
  const toolCallId = str(o, 'toolCallId', 'tool_call_id')
  const requestId = toolCallId || `acp_elicit_${Date.now().toString(36)}`
  const schema = asRecord(o.requestedSchema ?? o.requested_schema)
  const form: Array<Record<string, unknown>> = []
  const properties = schema ? asRecord(schema.properties) : null
  if (properties) {
    const required = Array.isArray(schema?.required) ? schema!.required as unknown[] : []
    for (const [name, spec] of Object.entries(properties)) {
      const field = asRecord(spec)
      if (!field) continue
      form.push({
        name,
        type: typeof field.type === 'string' ? field.type : 'string',
        label: typeof field.title === 'string' ? field.title : name,
        required: required.includes(name),
        ...(typeof field.description === 'string' ? { description: field.description } : {}),
      })
    }
  }
  return {
    elicitationId,
    interaction: {
      interactionId: requestId,
      kind: 'permission',
      toolName: serverName,
      toolUseId: toolCallId ?? requestId,
      createdAt: Date.now(),
      requestKind: 'mcp_elicitation',
      message,
      serverName,
      allowAlwaysAllow: false,
      input: {
        ...(url ? { elicitationUrl: url } : {}),
        ...(elicitationId ? { elicitationId } : {}),
        ...(form.length ? { elicitationForm: form } : {}),
      },
    },
  }
}

export function formatGrokElicitOutcome(allow: boolean): { outcome: 'accept' | 'cancel' } {
  return { outcome: allow ? 'accept' : 'cancel' }
}

/** Headless / no-UI answer for `x.ai/ask_user_question` — never leave the RPC hanging. */
export function formatGrokAskUserCancelled(): { outcome: 'cancelled' } {
  return { outcome: 'cancelled' }
}

export function formatGrokAskUserAccepted(answers: unknown): Record<string, unknown> {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return formatGrokAskUserCancelled()
  }
  return { outcome: 'accepted', answers }
}

/** Headless / no-UI answer for `x.ai/exit_plan_mode`. */
export function formatGrokExitPlanCancelled(feedback?: string): Record<string, unknown> {
  const trimmed = feedback?.trim()
  return { outcome: 'cancelled', ...(trimmed ? { feedback: trimmed } : {}) }
}

export function formatGrokExitPlanFromDecision(
  decision: 'approve' | 'reject',
  options?: Record<string, unknown>,
): Record<string, unknown> {
  if (decision === 'approve') return { outcome: 'approved' }
  const feedback = typeof options?.feedback === 'string' ? options.feedback : undefined
  return formatGrokExitPlanCancelled(feedback)
}
