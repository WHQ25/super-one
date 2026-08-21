import { describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import {
  createXaiCorrelationState,
  mapXaiSessionUpdate,
  mapXaiStandaloneNotification,
  noteToolCorrelationFromAgentEvents,
  parseXaiSessionNotificationEnvelope,
  XAI_FOLLOW_UPS,
  XAI_SESSION_NOTIFICATION,
  XAI_TASK_BACKGROUNDED,
  XAI_TASK_COMPLETED,
} from './acp-xai-session-notify'
import type { AgentEvent } from '@superone/shared/agent-types'

describe('parseXaiSessionNotificationEnvelope', () => {
  it('parses camelCase outer + snake_case update', () => {
    const env = parseXaiSessionNotificationEnvelope({
      sessionId: 's1',
      update: { sessionUpdate: 'workflow_updated', run_id: 'wf_1' },
      _meta: { eventId: 'e1', eventSeq: 3 },
    })
    expect(env).toMatchObject({
      sessionId: 's1',
      eventSeq: 3,
      eventId: 'e1',
    })
    expect(env?.update.sessionUpdate).toBe('workflow_updated')
  })

  it('tolerates snake_case outer keys', () => {
    const env = parseXaiSessionNotificationEnvelope({
      session_id: 's2',
      update: { session_update: 'subagent_finished', subagent_id: 'sa1' },
    })
    expect(env?.sessionId).toBe('s2')
  })

  it('returns null for garbage', () => {
    expect(parseXaiSessionNotificationEnvelope(null)).toBeNull()
    expect(parseXaiSessionNotificationEnvelope({})).toBeNull()
    expect(parseXaiSessionNotificationEnvelope({ update: 'x' })).toBeNull()
  })
})

describe('mapXaiSessionUpdate — workflow', () => {
  it('maps active workflow to task_started + task_progress', () => {
    const state = createXaiCorrelationState()
    state.workflowToolByRunId.set('wf_1', 'tool_wf')
    const events = mapXaiSessionUpdate({
      sessionUpdate: 'workflow_updated',
      run_id: 'wf_1',
      revision: 1,
      name: 'review-changes',
      objective: 'Review the PR',
      status: 'active',
      phases: [
        { title: 'Plan', state: 'done' },
        { title: 'Execute', state: 'active' },
      ],
      current_phase: 'Execute',
      agents: [
        { agent_id: 'a1', label: 'Explore', state: 'running', tokens_used: 100 },
      ],
      elapsed_ms: 12000,
      agents_used: 1,
    }, state)

    expect(events[0]).toMatchObject({
      type: 'task_started',
      taskId: 'wf_1',
      toolUseId: 'tool_wf',
      taskType: 'workflow',
    })
    expect(events[1]).toMatchObject({
      type: 'task_progress',
      taskId: 'wf_1',
      toolUseId: 'tool_wf',
    })
    expect((events[1] as Extract<AgentEvent, { type: 'task_progress' }>).summary).toContain('Execute')
    expect((events[1] as Extract<AgentEvent, { type: 'task_progress' }>).workflowAgents?.[0]).toMatchObject({
      agentId: 'a1',
      label: 'Explore',
      tokens: 100,
      state: 'running',
    })
    expect((events[1] as Extract<AgentEvent, { type: 'task_progress' }>).currentPhase).toBe('Execute')
    expect((events[1] as Extract<AgentEvent, { type: 'task_progress' }>).workflowPhases).toEqual([
      { title: 'Plan', state: 'done' },
      { title: 'Execute', state: 'active' },
    ])
  })

  it('maps complete with result_summary to task_notification', () => {
    const state = createXaiCorrelationState()
    // first start
    mapXaiSessionUpdate({
      sessionUpdate: 'workflow_updated',
      run_id: 'wf_2',
      revision: 1,
      name: 'r',
      objective: 'o',
      status: 'active',
      elapsed_ms: 1,
    }, state)
    const events = mapXaiSessionUpdate({
      sessionUpdate: 'workflow_updated',
      run_id: 'wf_2',
      revision: 2,
      name: 'r',
      objective: 'o',
      status: 'complete',
      elapsed_ms: 5000,
      result_summary: 'All good',
    }, state)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'task_notification',
      taskStatus: 'completed',
      resultText: 'All good',
    })
  })

  it('drops stale revisions', () => {
    const state = createXaiCorrelationState()
    mapXaiSessionUpdate({
      sessionUpdate: 'workflow_updated',
      run_id: 'wf_3',
      revision: 2,
      name: 'r',
      objective: 'o',
      status: 'active',
      elapsed_ms: 1,
    }, state)
    const events = mapXaiSessionUpdate({
      sessionUpdate: 'workflow_updated',
      run_id: 'wf_3',
      revision: 1,
      name: 'r',
      objective: 'o',
      status: 'active',
      elapsed_ms: 1,
    }, state)
    expect(events).toEqual([])
  })

  it('maps failed / cancelled statuses', () => {
    const state = createXaiCorrelationState()
    const failed = mapXaiSessionUpdate({
      sessionUpdate: 'workflow_updated',
      run_id: 'wf_f',
      revision: 1,
      name: 'r',
      objective: 'o',
      status: 'failed',
      elapsed_ms: 1,
    }, state)
    expect(failed.find((e) => e.type === 'task_notification')).toMatchObject({
      taskStatus: 'failed',
    })

    const cancelled = mapXaiSessionUpdate({
      sessionUpdate: 'workflow_updated',
      run_id: 'wf_c',
      revision: 1,
      name: 'r',
      objective: 'o',
      status: 'cancelled',
      elapsed_ms: 1,
    }, state)
    expect(cancelled.find((e) => e.type === 'task_notification')).toMatchObject({
      taskStatus: 'stopped',
    })
  })
})

describe('mapXaiSessionUpdate — subagent', () => {
  it('maps spawned / progress / finished', () => {
    const state = createXaiCorrelationState({ cwd: '/Users/me/proj' })
    state.subagentToolById.set('sa1', 'tool_sa')

    const spawned = mapXaiSessionUpdate({
      sessionUpdate: 'subagent_spawned',
      subagent_id: 'sa1',
      parent_session_id: 'p',
      child_session_id: 'sa1',
      subagent_type: 'explore',
      description: 'Search codebase',
    }, state)
    expect(spawned[0]).toMatchObject({
      type: 'task_started',
      taskId: 'sa1',
      toolUseId: 'tool_sa',
      description: 'Search codebase',
      taskType: 'explore',
      outputFile: expect.stringContaining('%2FUsers%2Fme%2Fproj/sa1/chat_history.jsonl'),
    })

    const progress = mapXaiSessionUpdate({
      sessionUpdate: 'subagent_progress',
      subagent_id: 'sa1',
      parent_session_id: 'p',
      child_session_id: 'sa1',
      duration_ms: 2000,
      turn_count: 1,
      tool_call_count: 3,
      tokens_used: 500,
      context_window_tokens: 200_000,
      context_usage_pct: 1,
      tools_used: ['read_file', 'grep'],
      error_count: 0,
    }, state)
    expect(progress[0]).toMatchObject({
      type: 'task_progress',
      taskId: 'sa1',
      description: 'sa1',
      activityText: 'read_file, grep',
      outputFile: expect.stringContaining('/sa1/chat_history.jsonl'),
    })
    // tools_used is a distinct-name set — no call-history rows, no lastToolName from set order
    expect(progress[0]).not.toHaveProperty('toolEntries')
    expect(progress[0]).not.toHaveProperty('lastToolName')
    // Subagent occupancy must not pollute parent context ring cache.
    expect(state.lastUsage).toBeNull()

    const finished = mapXaiSessionUpdate({
      sessionUpdate: 'subagent_finished',
      subagent_id: 'sa1',
      child_session_id: 'sa1',
      status: 'failed',
      error: 'boom',
      tool_calls: 3,
      turns: 1,
      duration_ms: 3000,
      tokens_used: 600,
    }, state)
    expect(finished[0]).toMatchObject({
      type: 'task_notification',
      taskStatus: 'failed',
      resultText: 'boom',
      outputFile: expect.stringContaining('/sa1/chat_history.jsonl'),
    })
  })

  it('defers subagent_finished until spawn, then applies both', () => {
    const state = createXaiCorrelationState()
    expect(mapXaiSessionUpdate({
      sessionUpdate: 'subagent_finished',
      subagent_id: 'late',
      status: 'completed',
    }, state)).toEqual([])
    const events = mapXaiSessionUpdate({
      sessionUpdate: 'subagent_spawned',
      subagent_id: 'late',
      description: 'Explore',
      subagent_type: 'explore',
    }, state)
    expect(events[0]).toMatchObject({ type: 'task_started', taskId: 'late', description: 'Explore' })
    expect(events[1]).toMatchObject({ type: 'task_notification', taskId: 'late', taskStatus: 'completed' })
  })

  it('flushes deferred finish when progress synthesizes start before spawn', () => {
    const state = createXaiCorrelationState()
    expect(mapXaiSessionUpdate({
      sessionUpdate: 'subagent_finished',
      subagent_id: 'late',
      status: 'completed',
    }, state)).toEqual([])
    const progress = mapXaiSessionUpdate({
      sessionUpdate: 'subagent_progress',
      subagent_id: 'late',
      child_session_id: 'late',
      duration_ms: 10,
      tool_call_count: 0,
      tokens_used: 0,
    }, state)
    expect(progress.map((e) => e.type)).toEqual(['task_started', 'task_notification'])
    expect(mapXaiSessionUpdate({
      sessionUpdate: 'subagent_spawned',
      subagent_id: 'late',
      description: 'Explore',
    }, state)).toEqual([])
  })
})

describe('mapXaiSessionUpdate — session meta', () => {
  it('maps last_turn_summary and session_recap', () => {
    const state = createXaiCorrelationState()
    expect(mapXaiSessionUpdate({
      sessionUpdate: 'last_turn_summary',
      summary: '  queue_worker shutdown race fixed; suite green  ',
      prompt_id: 'prompt-42',
    }, state, { messageId: 'msg-1' })).toEqual([{
      type: 'turn_summary',
      summary: 'queue_worker shutdown race fixed; suite green',
      promptId: 'prompt-42',
      messageId: 'msg-1',
    }])
    expect(mapXaiSessionUpdate({
      sessionUpdate: 'last_turn_summary',
      summary: '   ',
    }, state)).toEqual([])
    expect(mapXaiSessionUpdate({
      sessionUpdate: 'session_recap',
      summary: 'You fixed the parser race and wired retry backoff.',
      auto: true,
    }, state)).toEqual([{
      type: 'session_recap',
      summary: 'You fixed the parser race and wired retry backoff.',
      auto: true,
    }])
    expect(mapXaiSessionUpdate({
      sessionUpdate: 'session_recap_unavailable',
    }, state)).toEqual([{ type: 'session_recap_unavailable' }])
  })

  it('maps auto-compact lifecycle', () => {
    const state = createXaiCorrelationState()
    expect(mapXaiSessionUpdate({ sessionUpdate: 'auto_compact_started', tokens_used: 1, context_window: 2, percentage: 80, reason: 'x' }, state)).toEqual([
      { type: 'status_indicator', indicator: 'compacting' },
    ])
    const done = mapXaiSessionUpdate({
      sessionUpdate: 'auto_compact_completed',
      tokens_before: 1000,
      tokens_after: 400,
      elapsed_ms: 50,
    }, state)
    expect(done).toContainEqual({ type: 'status_indicator', indicator: null, compactResult: 'success' })
    expect(done).toContainEqual({
      type: 'compact_boundary',
      trigger: 'auto',
      preTokens: 1000,
      postTokens: 400,
      durationMs: 50,
    })
  })

  it('maps turn_completed usage to uncached footer + context occupancy', () => {
    const state = createXaiCorrelationState()
    // Live context occupancy from session/update _meta.totalTokens
    state.lastUsage = {
      categories: [],
      totalTokens: 42_000,
      maxTokens: 200_000,
      percentage: 21,
      model: 'grok',
    }
    const events = mapXaiSessionUpdate({
      sessionUpdate: 'turn_completed',
      prompt_id: 'p1',
      stop_reason: 'end_turn',
      usage: {
        // ACP identity: full input includes cache reads
        inputTokens: 1200,
        cachedReadTokens: 400,
        outputTokens: 300,
        totalTokens: 1500, // billing sum — must NOT become contextTokens
        costUsdTicks: 1e10, // $1
      },
    }, state, { messageId: 'msg-1' })
    expect(events).toEqual([{
      type: 'message_usage',
      messageId: 'msg-1',
      inputTokens: 800, // 1200 - 400 uncached
      outputTokens: 300,
      cacheReadTokens: 400,
      contextTokens: 42_000, // live occupancy, not billing total
      contextWindow: 200_000,
      costUsd: 1,
    }])
    expect(state.lastUsage?.totalTokens).toBe(42_000)
    expect(state.turnTokens).toEqual({ input: 0, output: 0, cacheRead: 0 })
  })

  it('accumulates response_started/completed into mid-turn message_usage', () => {
    const state = createXaiCorrelationState()
    state.lastUsage = {
      categories: [],
      totalTokens: 50_000,
      maxTokens: 200_000,
      percentage: 25,
      model: 'grok',
    }

    expect(mapXaiSessionUpdate({
      sessionUpdate: 'response_started',
      input_tokens: 1_000,
      cache_read_input_tokens: 200,
    }, state, { messageId: 'msg-1' })).toEqual([{
      type: 'message_usage',
      messageId: 'msg-1',
      inputTokens: 1_000,
      outputTokens: 0,
      cacheReadTokens: 200,
      contextTokens: 50_000,
      contextWindow: 200_000,
    }])
    expect(state.turnTokens).toEqual({ input: 0, output: 0, cacheRead: 0 })

    expect(mapXaiSessionUpdate({
      sessionUpdate: 'response_completed',
      usage: {
        input_tokens: 1_000,
        output_tokens: 150,
        cache_read_input_tokens: 200,
      },
    }, state, { messageId: 'msg-1' })).toEqual([{
      type: 'message_usage',
      messageId: 'msg-1',
      inputTokens: 1_000,
      outputTokens: 150,
      cacheReadTokens: 200,
      contextTokens: 50_000,
      contextWindow: 200_000,
    }])

    expect(mapXaiSessionUpdate({
      sessionUpdate: 'response_completed',
      usage: {
        inputTokens: 800,
        outputTokens: 50,
        cacheReadInputTokens: 100,
      },
    }, state, { messageId: 'msg-1' })).toEqual([{
      type: 'message_usage',
      messageId: 'msg-1',
      inputTokens: 1_800,
      outputTokens: 200,
      cacheReadTokens: 300,
      contextTokens: 50_000,
      contextWindow: 200_000,
    }])
    expect(state.turnTokens).toEqual({ input: 1_800, output: 200, cacheRead: 300 })
  })

  it('falls back to fullInput+output for single-call turn without meta occupancy', () => {
    const state = createXaiCorrelationState()
    state.lastUsage = {
      categories: [],
      totalTokens: 0,
      maxTokens: 500_000,
      percentage: 0,
      model: 'grok',
    }
    const events = mapXaiSessionUpdate({
      sessionUpdate: 'turn_completed',
      prompt_id: 'p1',
      stop_reason: 'end_turn',
      usage: {
        inputTokens: 1000,
        cachedReadTokens: 200,
        outputTokens: 100,
        totalTokens: 1100,
        modelCalls: 1,
      },
    }, state, { messageId: 'msg-1' })
    expect(events[0]).toMatchObject({
      type: 'message_usage',
      inputTokens: 800,
      outputTokens: 100,
      contextTokens: 1100, // fullInput + output for single call
      contextWindow: 500_000,
    })
  })

  it('updates context ring after auto-compact completes', () => {
    const state = createXaiCorrelationState()
    state.lastUsage = {
      categories: [],
      totalTokens: 1000,
      maxTokens: 200_000,
      percentage: 1,
      model: 'grok',
    }
    state.lastMessageId = 'msg-1'
    const done = mapXaiSessionUpdate({
      sessionUpdate: 'auto_compact_completed',
      tokens_before: 1000,
      tokens_after: 400,
      elapsed_ms: 50,
    }, state)
    expect(done).toContainEqual({
      type: 'message_usage',
      messageId: 'msg-1',
      inputTokens: 0,
      outputTokens: 0,
      contextTokens: 400,
      contextWindow: 200_000,
    })
    expect(state.lastUsage?.totalTokens).toBe(400)
  })

  it('maps model_changed and retry_state', () => {
    const state = createXaiCorrelationState()
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

  it('ignores unknown sessionUpdate without throwing', () => {
    const state = createXaiCorrelationState()
    expect(mapXaiSessionUpdate({ sessionUpdate: 'totally_new_future_variant', foo: 1 }, state)).toEqual([])
  })
})

describe('mapXaiSessionUpdate — turn_completed rate limit', () => {
  it('flags a quota-exhausted turn even though it carries no usage', () => {
    const state = createXaiCorrelationState()
    const events = mapXaiSessionUpdate({
      sessionUpdate: 'turn_completed',
      prompt_id: 'p1',
      stop_reason: 'rate_limit',
    }, state, { messageId: 'msg-1' })
    expect(events).toEqual([{ type: 'rate_limit', status: 'rejected', rateLimitType: 'api' }])
  })

  it('clears the limit on the next served turn, ahead of its usage', () => {
    const state = createXaiCorrelationState()
    mapXaiSessionUpdate({
      sessionUpdate: 'turn_completed',
      prompt_id: 'p1',
      stop_reason: 'rate_limit',
    }, state, { messageId: 'msg-1' })

    const events = mapXaiSessionUpdate({
      sessionUpdate: 'turn_completed',
      prompt_id: 'p2',
      stop_reason: 'end_turn',
      usage: { inputTokens: 100, outputTokens: 10, modelCalls: 1 },
    }, state, { messageId: 'msg-2' })

    expect(events[0]).toEqual({ type: 'rate_limit', status: 'allowed' })
    expect(events[1]).toMatchObject({ type: 'message_usage', messageId: 'msg-2' })
  })

  it('stays silent on served turns when no limit was hit', () => {
    const state = createXaiCorrelationState()
    const events = mapXaiSessionUpdate({
      sessionUpdate: 'turn_completed',
      prompt_id: 'p1',
      stop_reason: 'end_turn',
      usage: { inputTokens: 100, outputTokens: 10, modelCalls: 1 },
    }, state, { messageId: 'msg-1' })
    expect(events.some((e) => e.type === 'rate_limit')).toBe(false)
  })

  it('re-flags every rejected turn so a retry is not silent', () => {
    const state = createXaiCorrelationState()
    const update = { sessionUpdate: 'turn_completed', prompt_id: 'p1', stop_reason: 'rate_limit' }
    mapXaiSessionUpdate(update, state, { messageId: 'msg-1' })
    const second = mapXaiSessionUpdate({ ...update, prompt_id: 'p2' }, state, { messageId: 'msg-2' })
    expect(second).toEqual([{ type: 'rate_limit', status: 'rejected', rateLimitType: 'api' }])
  })
})

describe('mapXaiStandaloneNotification', () => {
  it('routes session_notification envelope', () => {
    const state = createXaiCorrelationState()
    const events = mapXaiStandaloneNotification(XAI_SESSION_NOTIFICATION, {
      sessionId: 's',
      update: {
        sessionUpdate: 'workflow_updated',
        run_id: 'wf_x',
        revision: 1,
        name: 'n',
        objective: 'o',
        status: 'active',
        elapsed_ms: 0,
      },
    }, state)
    expect(events.some((e) => e.type === 'task_started')).toBe(true)
  })

  it('keeps late subagent lifecycle even when eventSeq is behind', () => {
    const state = createXaiCorrelationState()
    state.lastEventSeq = 10
    const finish = mapXaiStandaloneNotification(XAI_SESSION_NOTIFICATION, {
      sessionId: 's',
      update: { sessionUpdate: 'subagent_finished', subagent_id: 'sa-late', status: 'completed' },
      _meta: { eventSeq: 8 },
    }, state)
    expect(finish).toEqual([])
    const spawn = mapXaiStandaloneNotification(XAI_SESSION_NOTIFICATION, {
      sessionId: 's',
      update: { sessionUpdate: 'subagent_spawned', subagent_id: 'sa-late', description: 'Review' },
      _meta: { eventSeq: 7 },
    }, state)
    expect(spawn.map((e) => e.type)).toEqual(['task_started', 'task_notification'])
  })

  it('maps tool_call_delta_chunk to a streaming tool chip plus input delta', () => {
    const state = createXaiCorrelationState()
    const first = mapXaiSessionUpdate({
      sessionUpdate: 'tool_call_delta_chunk',
      tool_call_id: 'call_1',
      tool_index: 0,
      name: 'search_replace',
      arguments_delta: '{"path":',
    }, state, { messageId: 'msg-1' })
    expect(first).toEqual([
      {
        type: 'content_delta',
        messageId: 'msg-1',
        delta: {
          type: 'tool_use',
          toolUseId: 'call_1',
          toolName: 'search_replace',
          input: '',
          status: 'streaming',
        },
      },
      {
        type: 'tool_input_delta',
        messageId: 'msg-1',
        toolUseId: 'call_1',
        partialJson: '{"path":',
      },
    ])
    const next = mapXaiSessionUpdate({
      sessionUpdate: 'tool_call_delta_chunk',
      tool_call_id: 'call_1',
      tool_index: 0,
      arguments_delta: '"a.ts"}',
    }, state, { messageId: 'msg-1' })
    expect(next).toEqual([{
      type: 'tool_input_delta',
      messageId: 'msg-1',
      toolUseId: 'call_1',
      partialJson: '"a.ts"}',
    }])
  })

  it('includes scheduled-task deletion reason when present', () => {
    const state = createXaiCorrelationState()
    expect(mapXaiSessionUpdate({
      sessionUpdate: 'scheduled_task_deleted',
      task_id: 't1',
      reason: 'expired',
    }, state)).toEqual([{
      type: 'task_notification',
      taskId: 't1',
      taskStatus: 'stopped',
      outputFile: '',
      summary: 'scheduled task deleted (expired)',
    }])
  })

  it('drops stale eventSeq for non-workflow', () => {
    const state = createXaiCorrelationState()
    state.lastEventSeq = 10
    const events = mapXaiStandaloneNotification(XAI_SESSION_NOTIFICATION, {
      sessionId: 's',
      update: { sessionUpdate: 'auto_compact_started', tokens_used: 1, context_window: 2, percentage: 1, reason: 'x' },
      _meta: { eventSeq: 5 },
    }, state)
    expect(events).toEqual([])
  })

  it('maps task_backgrounded / task_completed / follow_ups', () => {
    const state = createXaiCorrelationState()
    const bg = mapXaiStandaloneNotification(XAI_TASK_BACKGROUNDED, {
      tool_call_id: 'tc1',
      task_id: 'bg1',
      command: 'sleep 10',
      cwd: '/tmp',
      output_file: '/tmp/out.log',
      description: 'Wait',
    }, state)
    expect(bg).toEqual([{
      type: 'task_started',
      taskId: 'bg1',
      toolUseId: 'tc1',
      description: 'Wait',
      taskType: 'bash',
    }])

    // Dual emission dedup
    expect(mapXaiStandaloneNotification(XAI_TASK_BACKGROUNDED, {
      tool_call_id: 'tc1',
      task_id: 'bg1',
      command: 'sleep 10',
      cwd: '/tmp',
      output_file: '/tmp/out.log',
    }, state)).toEqual([])

    const done = mapXaiStandaloneNotification(XAI_TASK_COMPLETED, {
      task_snapshot: {
        task_id: 'bg1',
        command: 'sleep 10',
        cwd: '/tmp',
        output_file: '/tmp/out.log',
        output: 'done\n',
        completed: true,
        exit_code: 0,
      },
    }, state)
    expect(done[0]).toMatchObject({
      type: 'task_notification',
      taskId: 'bg1',
      taskStatus: 'completed',
      outputFile: '/tmp/out.log',
    })

    const follow = mapXaiStandaloneNotification(XAI_FOLLOW_UPS, {
      response_id: 'resp-1',
      suggestions: [
        { label: '  Run tests  ' },
        { label: '' },
        { label: 'Open PR' },
      ],
    }, state)
    expect(follow).toEqual([
      { type: 'prompt_suggestion', suggestion: 'Run tests' },
      { type: 'prompt_suggestion', suggestion: 'Open PR' },
    ])
  })

  it('maps goal_updated progress and complete', () => {
    const state = createXaiCorrelationState()
    const mid = mapXaiStandaloneNotification(XAI_SESSION_NOTIFICATION, {
      sessionId: 's',
      update: {
        sessionUpdate: 'goal_updated',
        goal_id: 'g1',
        objective: 'Ship feature',
        status: 'active',
        phase: 'executing',
        tokens_used: 100,
        elapsed_ms: 1000,
      },
    }, state)
    expect(mid[0]).toMatchObject({
      type: 'acp_goal',
      goal: { goalId: 'g1', objective: 'Ship feature', status: 'active' },
    })
    expect(mid[1]).toMatchObject({ type: 'task_started', taskId: 'g1', taskType: 'goal' })
    expect(mid[2]).toMatchObject({ type: 'task_progress', taskId: 'g1' })

    const done = mapXaiSessionUpdate({
      sessionUpdate: 'goal_updated',
      goal_id: 'g1',
      objective: 'Ship feature',
      status: 'complete',
      phase: 'idle',
      tokens_used: 200,
      elapsed_ms: 5000,
    }, state)
    expect(done[0]).toMatchObject({
      type: 'acp_goal',
      goal: { goalId: 'g1', status: 'complete' },
    })
    expect(done[1]).toMatchObject({ type: 'task_notification', taskStatus: 'completed' })
  })
})

describe('noteToolCorrelationFromAgentEvents', () => {
  it('stashes run_id from workflow tool_result JSON', () => {
    const state = createXaiCorrelationState()
    noteToolCorrelationFromAgentEvents([
      {
        type: 'content_delta',
        messageId: 'm1',
        delta: {
          type: 'tool_result',
          toolUseId: 'tu_wf',
          summary: JSON.stringify({ run_id: 'wf_corr', task_id: 't1', name: 'review' }),
          isError: false,
        },
      },
    ], state)
    expect(state.workflowToolByRunId.get('wf_corr')).toBe('tu_wf')
  })

  it('stashes run_id from real Grok WorkflowToolOutput (includes message)', () => {
    const state = createXaiCorrelationState()
    noteToolCorrelationFromAgentEvents([
      {
        type: 'content_delta',
        messageId: 'm1',
        delta: {
          type: 'tool_result',
          toolUseId: 'tu_wf',
          summary: JSON.stringify({
            run_id: 'wf_real',
            task_id: 'wf_real',
            name: 'review-changes',
            message: 'Workflow review-changes started. Progress appears under /workflows.',
          }),
          isError: false,
        },
      },
    ], state)
    expect(state.workflowToolByRunId.get('wf_real')).toBe('tu_wf')
  })

  it('does not bind run_id for validate_only workflow smoke-checks', () => {
    const state = createXaiCorrelationState()
    noteToolCorrelationFromAgentEvents([
      {
        type: 'content_delta',
        messageId: 'm1',
        delta: {
          type: 'tool_use',
          toolName: 'Workflow',
          toolUseId: 'tu_smoke',
          input: JSON.stringify({ script: 'let meta = #{ name: "x" };', validate_only: true }),
          status: 'complete',
        },
      },
      {
        type: 'content_delta',
        messageId: 'm1',
        delta: {
          type: 'tool_result',
          toolUseId: 'tu_smoke',
          summary: JSON.stringify({ run_id: 'wf-smoke', ok: true }),
          isError: false,
        },
      },
    ], state)
    expect(state.smokeWorkflowToolIds.has('tu_smoke')).toBe(true)
    expect(state.workflowToolByRunId.has('wf-smoke')).toBe(false)
  })

  it('stashes subagent_id from Grok plain-text spawn ack', () => {
    const state = createXaiCorrelationState()
    const summary = [
      'Subagent started in background.',
      'subagent_id: 019fdacb-c941-7893-979b-de49ff78a03f',
      'type: general-purpose',
      'description: [reviewer] commit 498e25ff',
      '',
      'Use get_command_or_subagent_output with task_ids=["019fdacb-c941-7893-979b-de49ff78a03f"] and',
      'timeout_ms to wait for results.',
    ].join('\n')
    noteToolCorrelationFromAgentEvents([
      {
        type: 'content_delta',
        messageId: 'm1',
        delta: {
          type: 'tool_result',
          toolUseId: 'tu_spawn',
          summary,
          isError: false,
        },
      },
    ], state)
    expect(state.subagentToolById.get('019fdacb-c941-7893-979b-de49ff78a03f')).toBe('tu_spawn')
    // Pure spawn ack must not dual-write bgTaskById (taskId falls back to subagentId).
    expect(state.bgTaskById.has('019fdacb-c941-7893-979b-de49ff78a03f')).toBe(false)
  })

  it('does not rebind subagent_id when a later tool echoes the spawn ack', () => {
    const state = createXaiCorrelationState()
    const summary = [
      'Subagent started in background.',
      'subagent_id: sa-echo',
    ].join('\n')
    noteToolCorrelationFromAgentEvents([
      {
        type: 'content_delta',
        messageId: 'm1',
        delta: {
          type: 'tool_use',
          toolName: 'Agent',
          toolUseId: 'tu_spawn',
          input: '{"description":"x"}',
          status: 'complete',
        },
      },
      {
        type: 'content_delta',
        messageId: 'm1',
        delta: {
          type: 'tool_result',
          toolUseId: 'tu_spawn',
          summary,
          isError: false,
        },
      },
    ], state)
    expect(state.subagentToolById.get('sa-echo')).toBe('tu_spawn')

    noteToolCorrelationFromAgentEvents([
      {
        type: 'content_delta',
        messageId: 'm1',
        delta: {
          type: 'tool_use',
          toolName: 'TaskOutput',
          toolUseId: 'tu_out',
          input: '{"task_ids":["sa-echo"]}',
          status: 'complete',
        },
      },
      {
        type: 'content_delta',
        messageId: 'm1',
        delta: {
          type: 'tool_result',
          toolUseId: 'tu_out',
          summary: 'subagent_id: sa-echo\nstarted in background',
          isError: false,
        },
      },
    ], state)
    expect(state.subagentToolById.get('sa-echo')).toBe('tu_spawn')
  })

  it('emits migration task_progress when correlating after provisional start', () => {
    const state = createXaiCorrelationState()
    state.subagentStarted.add('sa-late')
    const migrate = noteToolCorrelationFromAgentEvents([
      {
        type: 'content_delta',
        messageId: 'm1',
        delta: {
          type: 'tool_use',
          toolName: 'Agent',
          toolUseId: 'tu_late',
          input: '{}',
          status: 'complete',
        },
      },
      {
        type: 'content_delta',
        messageId: 'm1',
        delta: {
          type: 'tool_result',
          toolUseId: 'tu_late',
          summary: 'Subagent started in background.\nsubagent_id: sa-late',
          isError: false,
        },
      },
    ], state)
    expect(state.subagentToolById.get('sa-late')).toBe('tu_late')
    expect(migrate).toEqual([{
      type: 'task_progress',
      taskId: 'sa-late',
      toolUseId: 'tu_late',
      description: 'sa-late',
      usage: { totalTokens: 0, toolUses: 0, durationMs: 0 },
    }])
  })
})
