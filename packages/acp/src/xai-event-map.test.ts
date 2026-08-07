import { describe, expect, it } from 'vitest'
import {
  mapXaiSessionUpdate,
  mapXaiStandaloneNotification,
} from './xai-event-map'
import {
  XAI_FOLLOW_UPS,
  XAI_SESSION_NOTIFICATION,
  XAI_TASK_BACKGROUNDED,
  XAI_TASK_COMPLETED,
  createXaiCorrelationState,
  noteToolCorrelationFromAgentEvents,
  parseXaiSessionNotificationEnvelope,
} from './xai-state'

describe('ACP xAI AgentEvent mapping', () => {
  it('parses session notification envelopes and rejects malformed payloads', () => {
    expect(parseXaiSessionNotificationEnvelope({
      session_id: 'session-1',
      update: { session_update: 'subagent_finished' },
      _meta: { event_seq: 3, event_id: 'event-3' },
    })).toMatchObject({
      sessionId: 'session-1',
      eventSeq: 3,
      eventId: 'event-3',
    })
    expect(parseXaiSessionNotificationEnvelope({ update: 'invalid' })).toBeNull()
  })

  it('correlates Grok plain-text subagent spawn ack to toolUseId', () => {
    const state = createXaiCorrelationState()
    noteToolCorrelationFromAgentEvents([{
      type: 'content_delta',
      messageId: 'message-1',
      delta: {
        type: 'tool_result',
        toolUseId: 'spawn-tool',
        summary: [
          'Subagent started in background.',
          'subagent_id: 019fdacb-c941-7893-979b-de49ff78a03f',
          'type: general-purpose',
        ].join('\n'),
        isError: false,
      },
    }], state)
    expect(state.subagentToolById.get('019fdacb-c941-7893-979b-de49ff78a03f')).toBe('spawn-tool')
    // Pure spawn ack must not dual-write bgTaskById (taskId falls back to subagentId).
    expect(state.bgTaskById.has('019fdacb-c941-7893-979b-de49ff78a03f')).toBe(false)
  })

  it('does not rebind subagent_id from a non-spawn tool that echoes the ack', () => {
    const state = createXaiCorrelationState()
    noteToolCorrelationFromAgentEvents([
      {
        type: 'content_delta',
        messageId: 'm1',
        delta: {
          type: 'tool_use',
          toolName: 'Agent',
          toolUseId: 'spawn-tool',
          input: '{}',
          status: 'complete',
        },
      },
      {
        type: 'content_delta',
        messageId: 'm1',
        delta: {
          type: 'tool_result',
          toolUseId: 'spawn-tool',
          summary: 'Subagent started in background.\nsubagent_id: sa-1',
          isError: false,
        },
      },
    ], state)
    noteToolCorrelationFromAgentEvents([
      {
        type: 'content_delta',
        messageId: 'm1',
        delta: {
          type: 'tool_use',
          toolName: 'TaskOutput',
          toolUseId: 'out-tool',
          input: '{}',
          status: 'complete',
        },
      },
      {
        type: 'content_delta',
        messageId: 'm1',
        delta: {
          type: 'tool_result',
          toolUseId: 'out-tool',
          summary: 'Subagent started in background.\nsubagent_id: sa-1',
          isError: false,
        },
      },
    ], state)
    expect(state.subagentToolById.get('sa-1')).toBe('spawn-tool')
  })

  it('does not correlate validate_only workflow tool results to run_id', () => {
    const state = createXaiCorrelationState()
    noteToolCorrelationFromAgentEvents([
      {
        type: 'content_delta',
        messageId: 'message-1',
        delta: {
          type: 'tool_use',
          toolName: 'Workflow',
          toolUseId: 'smoke-tool',
          input: JSON.stringify({ script: 'let meta = #{ name: "x" };', validate_only: true }),
          status: 'complete',
        },
      },
      {
        type: 'content_delta',
        messageId: 'message-1',
        delta: {
          type: 'tool_result',
          toolUseId: 'smoke-tool',
          summary: JSON.stringify({ run_id: 'wf-smoke', ok: true }),
          isError: false,
        },
      },
    ], state)
    expect(state.smokeWorkflowToolIds.has('smoke-tool')).toBe(true)
    expect(state.workflowToolByRunId.has('wf-smoke')).toBe(false)
  })

  it('correlates workflow progress and drops stale revisions', () => {
    const state = createXaiCorrelationState()
    noteToolCorrelationFromAgentEvents([{
      type: 'content_delta',
      messageId: 'message-1',
      delta: {
        type: 'tool_result',
        toolUseId: 'workflow-tool',
        summary: JSON.stringify({ run_id: 'workflow-1' }),
        isError: false,
      },
    }], state)

    const active = mapXaiSessionUpdate({
      sessionUpdate: 'workflow_updated',
      run_id: 'workflow-1',
      revision: 2,
      name: 'review',
      objective: 'Review changes',
      status: 'active',
      current_phase: 'Inspect',
      phases: [{ title: 'Inspect', state: 'active' }],
      agents: [{ agent_id: 'agent-1', label: 'Reviewer', state: 'running', tokens_used: 100 }],
    }, state)
    expect(active[0]).toMatchObject({
      type: 'task_started',
      taskId: 'workflow-1',
      toolUseId: 'workflow-tool',
    })
    expect(active[1]).toMatchObject({
      type: 'task_progress',
      currentPhase: 'Inspect',
    })
    expect(mapXaiSessionUpdate({
      sessionUpdate: 'workflow_updated',
      run_id: 'workflow-1',
      revision: 1,
      status: 'complete',
    }, state)).toEqual([])
  })

  it('maps subagent progress and completion without changing parent usage', () => {
    const state = createXaiCorrelationState()
    state.subagentToolById.set('subagent-1', 'subagent-tool')

    expect(mapXaiSessionUpdate({
      sessionUpdate: 'subagent_spawned',
      subagent_id: 'subagent-1',
      subagent_type: 'explore',
      description: 'Inspect source',
    }, state)).toEqual([{
      type: 'task_started',
      taskId: 'subagent-1',
      toolUseId: 'subagent-tool',
      description: 'Inspect source',
      taskType: 'explore',
    }])
    expect(mapXaiSessionUpdate({
      sessionUpdate: 'subagent_progress',
      subagent_id: 'subagent-1',
      tools_used: ['read_file', 'grep'],
      tokens_used: 500,
      context_window_tokens: 200_000,
    }, state)[0]).toMatchObject({
      type: 'task_progress',
      taskId: 'subagent-1',
      description: 'grep',
      lastToolName: 'grep',
      activityText: 'read_file, grep',
      toolEntries: [
        { toolName: 'read_file', description: '' },
        { toolName: 'grep', description: '' },
      ],
    })
    expect(state.lastUsage).toBeNull()
    expect(mapXaiSessionUpdate({
      sessionUpdate: 'subagent_finished',
      subagent_id: 'subagent-1',
      status: 'failed',
      error: 'failed to inspect',
    }, state)[0]).toMatchObject({
      type: 'task_notification',
      taskStatus: 'failed',
      resultText: 'failed to inspect',
    })
  })

  it('does not bind workflow-owned subagents to the parent workflow toolUseId', () => {
    const state = createXaiCorrelationState()
    state.workflowToolByRunId.set('wf-1', 'workflow-tool')

    expect(mapXaiSessionUpdate({
      sessionUpdate: 'subagent_spawned',
      subagent_id: 'child-1',
      subagent_type: 'explore',
      description: 'Scan',
      workflow_run_id: 'wf-1',
    }, state)).toEqual([{
      type: 'task_started',
      taskId: 'child-1',
      description: 'Scan',
      taskType: 'explore',
    }])
    expect(state.workflowOwnedSubagents.has('child-1')).toBe(true)
    // Progress / finish for workflow children is mirrored via workflow_updated — emit nothing.
    expect(mapXaiSessionUpdate({
      sessionUpdate: 'subagent_progress',
      subagent_id: 'child-1',
      tools_used: ['grep'],
      tokens_used: 10,
    }, state)).toEqual([])
    expect(mapXaiSessionUpdate({
      sessionUpdate: 'subagent_finished',
      subagent_id: 'child-1',
      status: 'completed',
      output: 'done',
    }, state)).toEqual([])
  })

  it('surfaces result_summary on workflow terminal notification', () => {
    const state = createXaiCorrelationState()
    state.workflowToolByRunId.set('wf-1', 'workflow-tool')
    const events = mapXaiSessionUpdate({
      sessionUpdate: 'workflow_updated',
      run_id: 'wf-1',
      revision: 9,
      name: 'review',
      status: 'complete',
      result_summary: 'All agents agreed: ship it.',
      phases: [{ title: 'Done', state: 'done' }],
    }, state)
    expect(events).toContainEqual(expect.objectContaining({
      type: 'task_notification',
      taskId: 'wf-1',
      toolUseId: 'workflow-tool',
      taskStatus: 'completed',
      resultText: 'All agents agreed: ship it.',
      summary: 'All agents agreed: ship it.',
    }))
  })

  it('maps background tasks and follow-up suggestions with deduplication', () => {
    const state = createXaiCorrelationState()
    const background = {
      tool_call_id: 'bash-tool',
      task_id: 'task-1',
      command: 'sleep 1',
      output_file: '/tmp/task.log',
      description: 'Wait for result',
    }
    expect(mapXaiStandaloneNotification(XAI_TASK_BACKGROUNDED, background, state)).toEqual([{
      type: 'task_started',
      taskId: 'task-1',
      toolUseId: 'bash-tool',
      description: 'Wait for result',
      taskType: 'bash',
    }])
    expect(mapXaiStandaloneNotification(XAI_TASK_BACKGROUNDED, background, state)).toEqual([])
    expect(mapXaiStandaloneNotification(XAI_TASK_COMPLETED, {
      task_snapshot: {
        task_id: 'task-1',
        output_file: '/tmp/task.log',
        output: 'done',
        completed: true,
        exit_code: 0,
      },
    }, state)[0]).toMatchObject({
      type: 'task_notification',
      taskId: 'task-1',
      taskStatus: 'completed',
    })
    expect(mapXaiStandaloneNotification(XAI_FOLLOW_UPS, {
      response_id: 'response-1',
      suggestions: [{ label: ' Run tests ' }, { label: 'Open PR' }],
    }, state)).toEqual([
      { type: 'prompt_suggestion', suggestion: 'Run tests' },
      { type: 'prompt_suggestion', suggestion: 'Open PR' },
    ])
  })

  it('maps usage, compaction, model, and retry lifecycle', () => {
    const state = createXaiCorrelationState()
    state.lastUsage = {
      categories: [],
      totalTokens: 42_000,
      maxTokens: 200_000,
      percentage: 21,
      model: 'grok',
    }
    const usage = mapXaiSessionUpdate({
      sessionUpdate: 'turn_completed',
      usage: {
        inputTokens: 1_200,
        cachedReadTokens: 400,
        outputTokens: 300,
        costUsdTicks: 1e10,
      },
    }, state, { messageId: 'message-1' })
    expect(usage).toEqual([{
      type: 'message_usage',
      messageId: 'message-1',
      inputTokens: 800,
      outputTokens: 300,
      contextTokens: 42_000,
      contextWindow: 200_000,
      costUsd: 1,
    }])

    const compact = mapXaiSessionUpdate({
      sessionUpdate: 'auto_compact_completed',
      tokens_before: 42_000,
      tokens_after: 10_000,
      elapsed_ms: 50,
    }, state, { messageId: 'message-1' })
    expect(compact).toContainEqual({
      type: 'compact_boundary',
      trigger: 'auto',
      preTokens: 42_000,
      postTokens: 10_000,
      durationMs: 50,
    })
    expect(compact).toContainEqual(expect.objectContaining({
      type: 'message_usage',
      contextTokens: 10_000,
    }))
    expect(mapXaiSessionUpdate({
      sessionUpdate: 'model_changed',
      model_id: 'grok-4',
      reasoning_effort: 'high',
    }, state)).toEqual([{
      type: 'agent_setting_change',
      selectedModel: 'grok-4',
      selectedEffort: 'high',
    }])
    expect(mapXaiSessionUpdate({
      sessionUpdate: 'retry_state',
      type: 'retrying',
      attempt: 2,
      maxRetries: 5,
      reason: 'timeout',
    }, state)).toEqual([{
      type: 'api_retry',
      attempt: 2,
      maxRetries: 5,
      delayMs: 0,
      message: 'timeout',
    }])
  })

  it('deduplicates non-workflow notifications by event sequence', () => {
    const state = createXaiCorrelationState()
    const notification = (eventSeq: number): Record<string, unknown> => ({
      sessionId: 'session-1',
      update: { sessionUpdate: 'auto_compact_started' },
      _meta: { eventSeq },
    })
    expect(mapXaiStandaloneNotification(
      XAI_SESSION_NOTIFICATION,
      notification(2),
      state,
    )).toEqual([{ type: 'status_indicator', indicator: 'compacting' }])
    expect(mapXaiStandaloneNotification(
      XAI_SESSION_NOTIFICATION,
      notification(1),
      state,
    )).toEqual([])
  })
})
