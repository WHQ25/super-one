import type { AgentEvent } from '@superone/shared/agent-types'
import { isSubagentToolName } from '@superone/shared/tool-ui'
import type { DeliveryPolicy } from '../delivery-policy'
import {
  TODO_TOOLS,
  parseWorkflowTranscriptDir,
  remoteBashResult,
  remoteContentPorts,
  resolveTodoToolTodos,
  stripEventForRemote,
  stripProjectPath,
} from './remote-content'

/**
 * What one connection receives for each emitted event, before batching
 * (docs/architecture/mobile-remote-control.md, "Host event pipeline"). The
 * policy picks the stages: the link tier its cost controls, the client
 * surface its presentation adapters. They run in this order:
 *
 * 1. accumulate (phone): todo input deltas, which the filter drops next;
 * 2. filter (phone): events that feed desktop-only state;
 * 3. truncate (relay): slash command output;
 * 4. throttle (relay): tool progress;
 * 5. rewrite (phone): tool rows, subagent enrichment, heavy payload summaries.
 */

/** Events that feed desktop-only state; the phone never renders them. */
const DESKTOP_ONLY_EVENTS = new Set([
  'files_persisted', 'elicitation_complete', 'tool_input_delta',
  'subagent_usage', 'checkpoint_captured', 'hook_started', 'hook_complete', 'hook_progress',
  'stream_message_start', 'stream_message_stop',
])
/**
 * A slash command's stdout can be the whole deliverable — a review is the
 * answer the user asked for — so it is forwarded rather than dropped. It is
 * still bounded: `/doctor`-style commands emit output the client discards, and
 * a megabyte of it would be paid for over the relay before being thrown away.
 */
const MAX_SLASH_OUTPUT = 200_000
const THROTTLED_EVENTS = new Set(['tool_progress'])
const THROTTLE_INTERVAL_MS = 2_000

/** One session's in-flight tool calls, keyed by tool_use id; reset when the session starts a reply. */
interface LiveToolState {
  bashCommands: Map<string, string>
  todoInputs: Map<string, { toolName: string; input: string }>
  widgetIds: Set<string>
  agentIds: Set<string>
  agentOutputFiles: Map<string, string>
  workflowIds: Set<string>
  workflowTranscriptDirs: Map<string, string>
}

function emptyLiveToolState(): LiveToolState {
  return {
    bashCommands: new Map(),
    todoInputs: new Map(),
    widgetIds: new Set(),
    agentIds: new Set(),
    agentOutputFiles: new Map(),
    workflowIds: new Set(),
    workflowTranscriptDirs: new Map(),
  }
}

export interface ProfilePorts {
  now(): number
  /** Dev tracing of what leaves; optional. */
  trace?(category: string, label: string, data: unknown, key?: string): void
}

const defaultPorts: ProfilePorts = { now: () => Date.now() }

export class EventProfile {
  private readonly lastThrottledAt = new Map<string, number>()
  /**
   * What each live tool_result needs to know about its tool_use, per session:
   * a `message_start` in one session must not drop another session's
   * in-flight calls (a widget result would then be truncated like any other
   * and reach the phone as unparseable JSON).
   */
  private readonly liveTools = new Map<string, LiveToolState>()

  constructor(
    private policy: DeliveryPolicy,
    private readonly ports: ProfilePorts = defaultPorts,
  ) {}

  setPolicy(policy: DeliveryPolicy): void {
    this.policy = policy
  }

  /** The events this connection receives for one emitted event, in order. */
  apply(event: AgentEvent): AgentEvent[] {
    const phone = this.policy.surface === 'phone'
    const relay = this.policy.tier === 'relay'
    if (event.type === 'provider_changed') {
      this.ports.trace?.('remote.out', event.type, event)
      return [event]
    }
    if (phone) this.accumulate(event)
    if (phone && DESKTOP_ONLY_EVENTS.has(event.type)) return []
    if (relay && event.type === 'slash_command_output' && event.content.length > MAX_SLASH_OUTPUT) {
      return [{ ...event, content: `${event.content.slice(0, MAX_SLASH_OUTPUT)}\n\n… output truncated` }]
    }
    if (relay && this.throttled(event)) return []
    if (!phone) return [event]
    const out = this.rewrite(event)
    if (!out) return []
    this.ports.trace?.('remote.out', out.type, out, (out as Record<string, unknown>).messageId as string ?? '')
    return [out]
  }

  /** Todo tool input streams in `tool_input_delta`, which the filter drops next. */
  private accumulate(event: AgentEvent): void {
    if (event.type !== 'tool_input_delta' || !('toolUseId' in event)) return
    const entry = this.liveTools.get(event.sessionId ?? '')?.todoInputs.get(event.toolUseId as string)
    if (entry) entry.input += (event as { partialJson: string }).partialJson
  }

  private throttled(event: AgentEvent): boolean {
    if (!THROTTLED_EVENTS.has(event.type)) return false
    const now = this.ports.now()
    const last = this.lastThrottledAt.get(event.type) ?? 0
    if (now - last < THROTTLE_INTERVAL_MS) return true
    this.lastThrottledAt.set(event.type, now)
    return false
  }

  private liveToolsOf(sessionKey: string): LiveToolState {
    let state = this.liveTools.get(sessionKey)
    if (!state) this.liveTools.set(sessionKey, state = emptyLiveToolState())
    return state
  }

  /**
   * Rewrite tool rows for the phone, enrich subagent progress, strip heavy
   * payloads. A todo tool's call is held back: its result carries the list.
   */
  private rewrite(event: AgentEvent): AgentEvent | null {
    const sessionKey = event.sessionId ?? ''
    if (event.type === 'message_start') this.liveTools.set(sessionKey, emptyLiveToolState())
    const tools = this.liveToolsOf(sessionKey)

    if (event.type === 'content_delta') {
      // Additive deltas go unchanged, including whitespace, sequencing and
      // reasoning timestamps. Markdown parsing belongs to the chat renderer.
      if (event.delta.type === 'text' || event.delta.type === 'thinking') return event
      if (event.delta.type === 'tool_use' && event.delta.toolName === 'Bash') {
        try { const p = JSON.parse(event.delta.input); tools.bashCommands.set(event.delta.toolUseId, String(p.command ?? '')) } catch {}
      }
      if (event.delta.type === 'tool_use' && event.delta.toolName.endsWith('__widget_show')) {
        tools.widgetIds.add(event.delta.toolUseId)
      }
      if (event.delta.type === 'tool_use' && isSubagentToolName(event.delta.toolName)) {
        tools.agentIds.add(event.delta.toolUseId)
      }
      if (event.delta.type === 'tool_use' && event.delta.toolName === 'Workflow') {
        tools.workflowIds.add(event.delta.toolUseId)
      }
      if (event.delta.type === 'tool_use' && TODO_TOOLS.has(event.delta.toolName)) {
        tools.todoInputs.set(event.delta.toolUseId, { toolName: event.delta.toolName, input: event.delta.input })
        return null
      }
      if (event.delta.type === 'tool_result' && tools.todoInputs.has(event.delta.toolUseId)) {
        const entry = tools.todoInputs.get(event.delta.toolUseId)!
        const toolTodos = resolveTodoToolTodos(entry.toolName, entry.input, event.delta.toolTodos)
        return { ...event, delta: { type: 'todo_result', toolUseId: event.delta.toolUseId, summary: event.delta.summary, parentToolUseId: event.delta.parentToolUseId, todoToolName: entry.toolName, toolTodos } }
      }
      if (event.delta.type === 'tool_result' && tools.widgetIds.has(event.delta.toolUseId)) {
        return { ...event, delta: event.delta }
      }
      if (event.delta.type === 'tool_result' && tools.bashCommands.has(event.delta.toolUseId)) {
        return { ...event, delta: remoteBashResult(event.delta) }
      }
      if (event.delta.type === 'tool_result' && tools.agentIds.has(event.delta.toolUseId)) {
        const outputMatch = event.delta.summary?.match(/output_file:\s*(\S+)/)
        if (outputMatch) tools.agentOutputFiles.set(event.delta.toolUseId, outputMatch[1])
        return { ...event, delta: event.delta }
      }
      if (event.delta.type === 'tool_result' && tools.workflowIds.has(event.delta.toolUseId)) {
        const dir = parseWorkflowTranscriptDir(event.delta.summary)
        if (dir) tools.workflowTranscriptDirs.set(event.delta.toolUseId, dir)
      }
      return stripEventForRemote(event, event.projectPath)
    }

    let enriched = event
    if (event.remoteView !== 'summary' && event.type === 'task_progress' && event.toolUseId) {
      const outputFile = tools.agentOutputFiles.get(event.toolUseId)
      if (outputFile) {
        const { resultText: activityText, toolEntries } = remoteContentPorts().readAgentOutput(outputFile, event.projectPath)
        enriched = { ...event, ...(activityText ? { activityText } : {}), ...(toolEntries.length > 0 ? { toolEntries } : {}) }
      }
    }
    if (event.remoteView !== 'summary' && (enriched.type === 'task_progress' || enriched.type === 'task_notification') && enriched.toolUseId && tools.workflowIds.has(enriched.toolUseId)) {
      const dir = tools.workflowTranscriptDirs.get(enriched.toolUseId)
      if (dir) {
        const workflowAgents = remoteContentPorts().listWorkflowAgents(dir)
        if (workflowAgents.length > 0) enriched = { ...enriched, workflowAgents }
      }
    }
    if ((enriched.type === 'task_progress' || enriched.type === 'task_started') && enriched.description && event.projectPath) {
      enriched = { ...enriched, description: stripProjectPath(enriched.description, event.projectPath) }
    }
    return stripEventForRemote(enriched, event.projectPath)
  }
}
