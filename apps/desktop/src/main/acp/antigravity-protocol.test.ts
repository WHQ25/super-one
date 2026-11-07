import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { RequestPermissionRequest, SessionUpdate } from '@agentclientprotocol/sdk'
import { describe, expect, it } from 'vitest'
import type { AgentEvent, ContentBlock } from '@superone/shared/agent-types'
import { applyContentDelta, retractContentBlocks } from '@superone/shared/content-delta'
import { projectAntigravityModels } from '../../renderer/src/harness-ui/acp/model-options'
import { mapSessionUpdate } from './acp-event-map'
import { mapPermissionRequest } from './acp-permission-map'
import { decideAcpPermission, shouldAutoAllowAcpPermission } from './acp-permission-preapprove'
import { createXaiCorrelationState } from './acp-xai-session-notify'
import { ensureAntigravityAutoBootstrap } from './antigravity-auto-bootstrap'
import { closeAntigravityThinkingStep, finalizeAntigravityTurnThinking, openAntigravityThinkingStep, stampAntigravityThoughtDeltas, type AntigravityTurnThinkingScope } from './antigravity-runtime-bridge'
import { ANTIGRAVITY_SYSTEM_PROMPT_APPEND, antigravitySystemPromptAppend } from '../agent/superone-system-prompt'
import { ANTIGRAVITY_CLIENT_INFO, antigravityPermissionDisposition, antigravityPermissionMode, antigravitySessionMeta, extractAntigravitySecurityWarning, extractAntigravityToolNameFromTitle, extractAntigravityUserInputQuestion, isAntigravityUserInputRequest, makeAntigravityUserInputResponse, normalizeAntigravitySessionUpdate, sanitizeAntigravityToolPayload, selectAntigravityAutoApprovedOptionId } from './antigravity-protocol'
import {
  ANTIGRAVITY_DAILY_ENDPOINT,
  ANTIGRAVITY_PROD_ENDPOINT,
  parseAntigravityModelQuotas,
  parseAntigravityPlannerResponse,
  parseAntigravityPlanType,
  parseAntigravityQuotaSummary,
  parseAntigravityStepMetadata,
  parseAntigravityUserEmail,
  resolveAntigravityQuotaEndpoints,
} from './antigravity-usage'

describe('antigravity-protocol', () => {
  it('maps SuperOne permission modes and client policy to Antigravity', () => {
    expect(ANTIGRAVITY_CLIENT_INFO).toEqual({ name: 'zed', version: '0.0.0' })
    expect(antigravityPermissionMode('bypassPermissions')).toBe('yolo')
    expect(antigravityPermissionMode('auto')).toBe('auto')
    expect(antigravityPermissionMode('acceptEdits')).toBe('auto_edit')
    expect(antigravityPermissionMode('plan')).toBe('default')
    expect(antigravityPermissionMode('default')).toBe('default')
    expect(antigravitySessionMeta()).toEqual({ antigravity: { disabledTools: ['run_workflow'] } })
    expect(antigravitySessionMeta('auto')).toEqual({
      antigravity: { disabledTools: ['run_workflow'], modeId: 'auto' },
    })
    const fullSystemPrompt = antigravitySystemPromptAppend('Extra instructions')
    expect(fullSystemPrompt).toContain(ANTIGRAVITY_SYSTEM_PROMPT_APPEND)
    expect(fullSystemPrompt).toContain('singleDollarTextMath: false')
    expect(fullSystemPrompt).toContain('Extra instructions')
    expect(antigravitySessionMeta('auto', fullSystemPrompt)).toEqual({
      antigravity: {
        disabledTools: ['run_workflow'],
        modeId: 'auto',
        systemPrompt: { append: fullSystemPrompt },
      },
    })

    const makeReq = (kind: string, toolCallId = 'call_1'): RequestPermissionRequest =>
      ({
        sessionId: 'sess-1',
        toolCall: { toolCallId, title: 'Run tool', kind },
        options: [
          { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'always', name: 'Allow always', kind: 'allow_always' },
        ],
      }) as unknown as RequestPermissionRequest

    expect(antigravityPermissionDisposition('default', makeReq('read'))).toBe('allow')
    expect(antigravityPermissionDisposition('default', makeReq('edit'))).toBe('ask')
    expect(antigravityPermissionDisposition('default', makeReq('execute'))).toBe('ask')
    expect(antigravityPermissionDisposition('acceptEdits', makeReq('edit'))).toBe('allow')
    expect(antigravityPermissionDisposition('acceptEdits', makeReq('execute'))).toBe('ask')
    expect(antigravityPermissionDisposition('auto', makeReq('read'))).toBe('allow')
    expect(antigravityPermissionDisposition('auto', makeReq('edit'))).toBe('ask')
    expect(antigravityPermissionDisposition('auto', makeReq('execute'))).toBe('ask')
    expect(antigravityPermissionDisposition('auto', makeReq('execute', 'interaction_1'))).toBe('ask')
    expect(antigravityPermissionDisposition('bypassPermissions', makeReq('execute'))).toBe('allow')
    expect(selectAntigravityAutoApprovedOptionId(makeReq('execute'))).toBe('once')

    const tempRoot = mkdtempSync(join(tmpdir(), 'agy-bootstrap-'))
    try {
      const bootstrap = ensureAntigravityAutoBootstrap(tempRoot)
      expect(existsSync(join(bootstrap.bootstrapDir, 'pyvenv.cfg'))).toBe(true)
      const siteCustomizePath = join(
        bootstrap.bootstrapDir,
        'lib',
        'python3.13',
        'site-packages',
        'sitecustomize.py',
      )
      expect(existsSync(siteCustomizePath)).toBe(true)
      expect(readFileSync(siteCustomizePath, 'utf8')).toContain('policy_mod.auto')
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('extracts Gemini model quotas when summary only returns 3p buckets', () => {
    const summaryWins = parseAntigravityQuotaSummary({
      groups: [
        {
          displayName: 'Claude and GPT models',
          buckets: [
            { bucketId: '3p-weekly', window: 'weekly', remainingFraction: 1 },
            { bucketId: '3p-5h', window: '5h', remainingFraction: 1 },
          ],
        },
      ],
    })
    expect(summaryWins.map((w) => w.label)).toEqual([
      'Claude & GPT · Weekly',
      'Claude & GPT · 5 Hours',
    ])

    const modelWins = parseAntigravityModelQuotas({
      models: {
        'gemini-4-argon-high': {
          modelProvider: 'MODEL_PROVIDER_GOOGLE',
          quotaInfo: { remainingFraction: 0.8, resetTime: '2026-11-03T18:00:00Z' },
          weeklyQuotaInfo: { remainingFraction: 0.9, resetTime: '2026-11-10T18:00:00Z' },
        },
        'gemini-3.8-flash-high': {
          modelProvider: 'MODEL_PROVIDER_GOOGLE',
          quotaInfo: { remainingFraction: 0.6, resetTime: '2026-11-03T18:00:00Z' },
        },
      },
    })
    expect(modelWins).toEqual([
      {
        id: 'gemini-5h',
        label: 'Gemini · 5 Hours',
        usedPercent: expect.closeTo(40, 5),
        resetsAt: Math.floor(Date.parse('2026-11-03T18:00:00Z') / 1000),
        windowDurationMins: 300,
      },
      {
        id: 'gemini-weekly',
        label: 'Gemini · Weekly',
        usedPercent: expect.closeTo(10, 5),
        resetsAt: Math.floor(Date.parse('2026-11-10T18:00:00Z') / 1000),
        windowDurationMins: 10080,
      },
    ])

    expect(
      parseAntigravityPlanType({
        paidTier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
        currentTier: { id: 'standard-tier', name: 'Standard' },
        cloudaicompanionProject: 'proj-123',
      }),
    ).toEqual({
      planType: 'AI Pro',
      projectId: 'proj-123',
    })

    expect(
      parseAntigravityPlanType({
        paidTier: { id: 'standard-tier', name: 'Standard', usesGcpTos: true },
        cloudaicompanionProject: 'proj-ent',
      }),
    ).toEqual({
      planType: 'Standard',
      projectId: 'proj-ent',
      usesGcpTos: true,
    })

    expect(resolveAntigravityQuotaEndpoints(undefined)).toEqual([
      ANTIGRAVITY_DAILY_ENDPOINT,
      ANTIGRAVITY_PROD_ENDPOINT,
    ])
    expect(resolveAntigravityQuotaEndpoints(false)).toEqual([
      ANTIGRAVITY_DAILY_ENDPOINT,
      ANTIGRAVITY_PROD_ENDPOINT,
    ])
    expect(resolveAntigravityQuotaEndpoints(true)).toEqual([
      ANTIGRAVITY_PROD_ENDPOINT,
      ANTIGRAVITY_DAILY_ENDPOINT,
    ])

    expect(parseAntigravityUserEmail({ email: ' dev@example.com ' })).toBe('dev@example.com')
    expect(parseAntigravityUserEmail({})).toBeNull()
  })

  it('collapses Antigravity effort-suffixed models into base models + effort slider options', () => {
    const models = [
      { id: 'gemini-4-argon-medium', name: 'Gemini 4 Argon (Medium)', description: 'gemini-4-argon-medium' },
      { id: 'gemini-4-argon-high', name: 'Gemini 4 Argon (High)', description: 'gemini-4-argon-high' },
      { id: 'gemini-4-argon-low', name: 'Gemini 4 Argon (Low)', description: 'gemini-4-argon-low' },
      { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)', description: 'gemini-3.8-flash-high' },
      { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)', description: 'gemini-3.8-flash-medium' },
      { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)', description: 'gemini-3.8-flash-low' },
      { id: 'gemini-pro-agent', name: 'Gemini 3.1 Pro (High)', description: 'gemini-pro-agent' },
      { id: 'gemini-3.1-pro-low', name: 'Gemini 3.1 Pro (Low)', description: 'gemini-3.1-pro-low' },
    ]
    const projected = projectAntigravityModels(models, 'gemini-3.8-flash-high')
    expect(projected.models).toEqual([
      { id: 'gemini-4-argon', name: 'Gemini 4 Argon', description: 'gemini-4-argon' },
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', description: 'gemini-3.8-flash' },
      { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', description: 'gemini-3.1-pro' },
    ])
    expect(projected.selectedBaseModelId).toBe('gemini-3.8-flash')
    expect(projected.selectedModelLabel).toBe('Gemini 3.8 Flash')
    expect(projected.selectedEffort).toBe('high')
    expect(projected.selectedEffortLabel).toBe('High')
    expect(projected.effortOptions.map((o) => o.value)).toEqual(['low', 'medium', 'high'])
    expect(projected.resolveEffortModelId('medium')).toBe('gemini-3.8-flash-medium')
    expect(projected.resolveModelId('gemini-4-argon')).toBe('gemini-4-argon-high')
    expect(projected.resolveModelId('gemini-3.1-pro', 'high')).toBe('gemini-pro-agent')

    const v145Models = [
      { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', description: '' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', description: '' },
      { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)', description: '' },
      { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)', description: '' },
    ]
    const v145Projected = projectAntigravityModels(v145Models, 'gpt-oss-120b-medium')
    expect(v145Projected.models.map((m) => m.id)).toEqual([
      'gemini-3.1-pro',
      'claude-sonnet-4-6',
      'claude-opus-4-6-thinking',
      'gpt-oss-120b-medium',
    ])
    expect(v145Projected.selectedBaseModelId).toBe('gpt-oss-120b-medium')
    expect(v145Projected.selectedModelLabel).toBe('GPT-OSS 120B (Medium)')
    expect(v145Projected.effortOptions).toEqual([])
  })

  it('identifies interaction_* permission requests as user questions and never preapproves them', () => {
    const request: RequestPermissionRequest = {
      sessionId: 'sess-1',
      toolCall: {
        toolCallId: 'interaction_ask_1',
        title: 'Which deployment target should we use?',
        rawInput: { tool_name: 'mcp__superone__memory_get' },
      },
      options: [
        { optionId: 'opt_staging', name: 'Staging', kind: 'allow_once' },
        { optionId: 'opt_prod', name: 'Production', kind: 'allow_once' },
      ],
    }

    expect(isAntigravityUserInputRequest(request)).toBe(true)
    expect(shouldAutoAllowAcpPermission(request)).toEqual({ allow: false })
    expect(decideAcpPermission(request, 'sess-1')).toEqual({ kind: 'prompt' })

    const question = extractAntigravityUserInputQuestion(request)
    expect(question?.toolCallId).toBe('interaction_ask_1')
    expect(question?.questions).toHaveLength(1)
    expect(question?.questions?.[0]?.question).toBe('Which deployment target should we use?')
    expect(question?.questions?.[0]?.options?.map((o) => o.label)).toEqual([
      'Staging',
      'Production',
    ])

    const byLabel = makeAntigravityUserInputResponse(request, {
      answers: { interaction_ask_1: 'Production' },
    })
    expect(byLabel).toEqual({
      outcome: { outcome: 'selected', optionId: 'opt_prod' },
    })

    const byOptionId = makeAntigravityUserInputResponse(request, {
      answers: { interaction_ask_1: 'opt_staging' },
    })
    expect(byOptionId).toEqual({
      outcome: { outcome: 'selected', optionId: 'opt_staging' },
    })
  })

  it('extracts agy.security.warning metadata onto permission requests', () => {
    const request: RequestPermissionRequest = {
      sessionId: 'sess-1',
      toolCall: {
        toolCallId: 'call_bash_1',
        title: 'Run command',
        rawInput: {
          CommandLine: 'rm -rf dist',
          WorkingDirectory: '/tmp/project',
        },
      },
      options: [
        { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
        {
          optionId: 'always',
          name: 'Allow always',
          kind: 'allow_always',
          _meta: {
            'agy.security.warning': {
              title: 'Destructive command',
              message: 'Allowing all shell commands can modify files outside the workspace.',
            },
          },
        } as RequestPermissionRequest['options'][number],
      ],
    }

    expect(extractAntigravitySecurityWarning(request.options)).toBe(
      'Allowing all shell commands can modify files outside the workspace.',
    )

    const mapped = mapPermissionRequest(request)
    expect(mapped.request.toolName).toBe('Bash')
    expect(mapped.request.input.command).toBe('rm -rf dist')
    expect(mapped.request.decisionReason).toContain(
      'Allowing all shell commands can modify files outside the workspace.',
    )
  })

  it('normalizes Antigravity tool_call updates and strips inline base64 images', () => {
    const update = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc_1',
      status: 'completed',
      rawInput: {
        CommandLine: 'bun test',
        WorkingDirectory: '/repo',
        preview: 'data:image/png;base64,AAAA',
      },
      rawOutput: {
        combinedOutput: 'PASS 1 test\n',
        formattedOutput: 'PASS 1 test\n',
        exitCode: 0,
      },
    } as unknown as SessionUpdate

    const normalized = normalizeAntigravitySessionUpdate(update) as Extract<
      SessionUpdate,
      { sessionUpdate: 'tool_call_update' }
    >
    expect(normalized.kind).toBe('execute')
    const rawIn = normalized.rawInput as Record<string, unknown>
    expect(rawIn.command).toBe('bun test')
    expect(rawIn.cwd).toBe('/repo')
    expect(rawIn.preview).toBeUndefined()

    const rawOut = normalized.rawOutput as Record<string, unknown>
    expect(rawOut.stdout).toBe('PASS 1 test\n')
    expect(rawOut.formattedOutput).toBeUndefined()
  })

  it('classifies non-MCP start_subagent tool calls as Agent', () => {
    const update = {
      sessionUpdate: 'tool_call',
      toolCallId: 'sub_1',
      title: 'Running start_subagent',
      rawInput: { task: 'Audit auth flow' },
    } as unknown as SessionUpdate

    const normalized = normalizeAntigravitySessionUpdate(update) as Extract<
      SessionUpdate,
      { sessionUpdate: 'tool_call' }
    >
    const rawIn = normalized.rawInput as Record<string, unknown>
    expect(rawIn.variant).toBe('Agent')
    expect(rawIn.description).toBe('Audit auth flow')
  })

  it('bounds oversized tool payload strings', () => {
    const huge = 'x'.repeat(20_000)
    const sanitized = sanitizeAntigravityToolPayload({ output: huge }) as { output: string }
    expect(sanitized.output.length).toBeLessThan(9_000)
    expect(sanitized.output).toContain('[Earlier output truncated]')
  })

  it('preserves large widget_show inputs and unwraps Antigravity timestamp headers and spilled step output files', () => {
    const largeWidgetCode = `<style>.dot { height: 7px; }</style><div>${'<span>quota</span>'.repeat(700)}</div><script>window.ok = 1;</script>`
    expect(largeWidgetCode.length).toBeGreaterThan(10_000)
    const tempRoot = mkdtempSync(join(tmpdir(), 'agy-widget-spill-'))
    try {
      const stepDir = join(tempRoot, '.system_generated', 'steps', '14')
      mkdirSync(stepDir, { recursive: true })
      const spilledFile = join(stepDir, 'output.txt')
      const widgetResultJson = JSON.stringify({
        title: 'account_quota_popover_final_v3',
        widget_code: largeWidgetCode,
      })
      writeFileSync(spilledFile, widgetResultJson, 'utf8')
      const spilledNotice = [
        'Created At: 2026-11-04T20:44:00+08:00',
        'Completed At: 2026-11-04T20:44:00+08:00',
        `The output was large and was saved to: ${pathToFileURL(spilledFile).href}`,
      ].join('\n')

      const completedUpdate = normalizeAntigravitySessionUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'widget_1',
        title: 'Running superone_widget_show',
        kind: 'other',
        status: 'completed',
        rawInput: {
          ServerName: 'superone',
          ToolName: 'widget_show',
          Arguments: { title: 'account_quota_popover_final_v3', widget_code: largeWidgetCode },
        },
        rawOutput: spilledNotice,
        content: [{ type: 'content', content: { type: 'text', text: spilledNotice } }],
      } as unknown as SessionUpdate)

      const mapped = mapSessionUpdate(completedUpdate, { messageId: 'msg_w1' })
      const toolUseDelta = mapped.find(
        (ev) => ev.type === 'content_delta' && ev.delta.type === 'tool_use',
      ) as Extract<AgentEvent, { type: 'content_delta' }> | undefined
      const toolResultDelta = mapped.find(
        (ev) => ev.type === 'content_delta' && ev.delta.type === 'tool_result',
      ) as Extract<AgentEvent, { type: 'content_delta' }> | undefined

      expect(toolUseDelta?.delta).toMatchObject({
        type: 'tool_use',
        toolName: 'mcp__superone__widget_show',
        input: JSON.stringify({ title: 'account_quota_popover_final_v3', widget_code: largeWidgetCode }),
      })
      expect(toolResultDelta?.delta).toEqual({
        type: 'tool_result',
        toolUseId: 'widget_1',
        summary: widgetResultJson,
        isError: false,
      })
      expect(JSON.stringify(mapped)).not.toContain('[Earlier output truncated]')
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('unwraps and auto-approves built-in SuperOne MCP tools from Antigravity permission and session updates', () => {
    expect(extractAntigravityToolNameFromTitle('Running superone_session_rename')).toBe(
      'superone_session_rename',
    )
    expect(extractAntigravityToolNameFromTitle('Run superone_session_rename?')).toBe(
      'superone_session_rename',
    )

    const permReq: RequestPermissionRequest = {
      sessionId: 'sess-1',
      toolCall: {
        toolCallId: 'mcp_1',
        title: 'Run superone_session_rename?',
        kind: 'other',
        rawInput: {
          server: 'superone',
          tool: 'session_rename',
          arguments: { title: 'Antigravity Debug' },
        },
      },
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
      ],
    }

    expect(shouldAutoAllowAcpPermission(permReq)).toEqual({
      allow: true,
      toolName: 'mcp__superone__session_rename',
      reason: 'builtin',
    })
    expect(decideAcpPermission(permReq, 'sess-1')).toEqual({
      kind: 'auto-allow',
      toolName: 'mcp__superone__session_rename',
      reason: 'builtin',
      alwaysAllow: false,
    })

    const startUpdate = normalizeAntigravitySessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'mcp_1',
      title: 'Running superone_session_rename',
      kind: 'other',
      status: 'pending',
      rawInput: {
        server: 'superone',
        tool: 'session_rename',
        arguments: { title: 'Antigravity Debug' },
      },
    } as unknown as SessionUpdate)

    const mappedEvents = mapSessionUpdate(startUpdate, { messageId: 'msg_1' })
    expect(mappedEvents).toEqual([
      {
        type: 'content_delta',
        messageId: 'msg_1',
        delta: {
          type: 'tool_use',
          toolUseId: 'mcp_1',
          toolName: 'mcp__superone__session_rename',
          toolFilePath: undefined,
          toolSummary: undefined,
          input: JSON.stringify({ title: 'Antigravity Debug' }),
          status: 'streaming',
        },
      },
    ])
  })

  it('normalizes Antigravity PascalCase file and search tool inputs into SuperOne UI tool blocks', () => {
    const viewUpdate = normalizeAntigravitySessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'read_1',
      title: 'Running view_file',
      kind: 'read',
      status: 'in_progress',
      rawInput: {
        AbsolutePath: '/workspace/src/index.ts',
        StartLine: 10,
        EndLine: 30,
      },
    } as unknown as SessionUpdate)

    const mappedView = mapSessionUpdate(viewUpdate, { messageId: 'msg_1' })
    expect(mappedView).toEqual([
      {
        type: 'content_delta',
        messageId: 'msg_1',
        delta: {
          type: 'tool_use',
          toolUseId: 'read_1',
          toolName: 'Read',
          toolFilePath: '/workspace/src/index.ts',
          toolSummary: undefined,
          input: JSON.stringify({
            file_path: '/workspace/src/index.ts',
            offset: 10,
            limit: 21,
          }),
          status: 'streaming',
        },
      },
    ])
  })

  it('replaces preview toolSummary with real MCP result in completed session update', () => {
    const previewSummary = 'Read session metadata'
    const realResultJson = JSON.stringify({
      session: { id: 's-123', title: 'Test Session' },
    })
    const completedUpdate = normalizeAntigravitySessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call_read_meta',
      title: 'Session Meta Read',
      kind: 'other',
      status: 'completed',
      rawInput: {
        ServerName: 'superone',
        ToolName: 'session_read',
        Arguments: { sessionId: 's-123', view: 'meta' },
        toolAction: 'Reading session',
        toolSummary: previewSummary,
      },
      rawOutput: {
        content: [{ type: 'text', text: realResultJson }],
      },
      content: [{ type: 'content', content: { type: 'text', text: previewSummary } }],
    } as unknown as SessionUpdate)

    expect(completedUpdate.content).toEqual([
      { type: 'content', content: { type: 'text', text: realResultJson } },
    ])

    const mapped = mapSessionUpdate(completedUpdate, { messageId: 'msg_m1' })
    const toolResultDelta = mapped.find(
      (ev) => ev.type === 'content_delta' && ev.delta.type === 'tool_result',
    ) as Extract<AgentEvent, { type: 'content_delta' }> | undefined

    expect(toolResultDelta?.delta).toEqual({
      type: 'tool_result',
      toolUseId: 'call_read_meta',
      summary: realResultJson,
      isError: false,
    })
  })

  it('decodes Antigravity protobuf step metadata and planner thinking payloads', () => {
    const metadataHex =
      '0a0b088be9d7ce0610c8de9725320b088de9d7ce0610f89eb24b420b088de9d7ce061088ac884d4a2b0a154d4f44454c5f504c414345484f4c4445525f4d333710918401181f22083a060801109184014847501fc2011d084720c0843d2a00421367656d696e692d332e312d70726f2d68696768'
    const meta = parseAntigravityStepMetadata(Buffer.from(metadataHex, 'hex'))
    expect(meta.inputTokens).toBe(16913)
    expect(meta.outputTokens).toBe(31)
    expect(meta.thoughtsTokens).toBe(71)
    expect(meta.candidatesTokens).toBe(31)
    expect(meta.contextWindow).toBe(1000000)
    expect(meta.model).toBe('gemini-3.1-pro-high')
    expect(meta.createdAtMs).toBeGreaterThan(1700000000000)
    expect(meta.viewableAtMs).toBeGreaterThanOrEqual(meta.createdAtMs)

    const encodeLen = (field: number, bytes: Uint8Array): Uint8Array => {
      const tag = (field << 3) | 2
      return Buffer.concat([Buffer.from([tag, bytes.length]), Buffer.from(bytes)])
    }
    const inner = Buffer.concat([
      encodeLen(1, Buffer.from('Final answer')),
      encodeLen(3, Buffer.from('Step-by-step reasoning')),
      encodeLen(11, Buffer.from([0x08, 0x03])),
    ])
    const outer = Buffer.concat([Buffer.from([0xa2, 0x01, inner.length]), inner])
    const parsed = parseAntigravityPlannerResponse(outer)
    expect(parsed).toEqual({
      responseText: 'Final answer',
      thinkingText: 'Step-by-step reasoning',
      thinkingDurationMs: 3000,
    })

    const scope: AntigravityTurnThinkingScope = {
      sawAgentThoughtChunk: false,
      stepIndex: 0,
      stepStartedAt: 1000,
      currentStepHasThinking: false,
      currentStepThinkingClosed: false,
      currentStepHasThoughtText: false,
      emittedStepThinkingIds: [],
    }
    let content: ContentBlock[] = []
    const apply = (ev: AgentEvent) => {
      if (ev.type === 'content_delta') content = applyContentDelta(content, ev.delta)
      else if (ev.type === 'content_retracted') content = retractContentBlocks(content, ev.blocks)
    }
    openAntigravityThinkingStep(scope, 'm1', apply)
    expect(content[0]).toMatchObject({ type: 'thinking', id: 'agy_think_step_0', thinking: '' })
    expect((content[0] as Extract<ContentBlock, { type: 'thinking' }>).endedAt).toBeUndefined()
    const chunkEvents = mapSessionUpdate(
      { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'First thought. ' } } as SessionUpdate,
      { messageId: 'm1' },
    )
    stampAntigravityThoughtDeltas(scope, chunkEvents)
    chunkEvents.forEach(apply)
    expect(content[0]).toMatchObject({ type: 'thinking', id: 'agy_think_step_0', thinking: 'First thought. ' })
    expect((content[0] as Extract<ContentBlock, { type: 'thinking' }>).endedAt).toBeUndefined()
    closeAntigravityThinkingStep(scope, 'm1', apply)
    expect(content[0]).toMatchObject({ type: 'thinking', id: 'agy_think_step_0', thinking: 'First thought. ' })
    expect((content[0] as Extract<ContentBlock, { type: 'thinking' }>).endedAt).toEqual(expect.any(Number))
    scope.stepIndex = 1
    scope.currentStepHasThinking = false
    openAntigravityThinkingStep(scope, 'm1', apply)
    expect(content).toHaveLength(2)
    finalizeAntigravityTurnThinking('nonexistent-session', 'm1', scope, createXaiCorrelationState(), apply)
    expect(content).toHaveLength(1)
  })

  it('normalizes sparse tool_call_update for an open MCP tool without dropping rawOutput', () => {
    const startUpdate = normalizeAntigravitySessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'mcp_call_read_1',
      title: 'Running superone_session_read',
      kind: 'other',
      status: 'pending',
      rawInput: {
        ServerName: 'superone',
        ToolName: 'session_read',
        Arguments: { sessionId: 'session-xyz-123' },
      },
    } as unknown as SessionUpdate)

    const mappedStart = mapSessionUpdate(startUpdate, { messageId: 'msg_1' })
    const toolUse = mappedStart.find((e) => e.type === 'content_delta' && e.delta.type === 'tool_use')
    expect(toolUse).toBeDefined()
    if (toolUse?.type === 'content_delta' && toolUse.delta.type === 'tool_use') {
      expect(toolUse.delta.toolName).toBe('mcp__superone__session_read')
    }

    const realMarkdownSession = [
      'environmentId: localhost',
      '# Session session-xyz-123 — text',
      'title: My Test Session · harness: acp · messages: 10',
      'A'.repeat(5000),
    ].join('\n')

    const completedUpdate = normalizeAntigravitySessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'mcp_call_read_1',
      status: 'completed',
      rawOutput: realMarkdownSession,
      content: [{ type: 'content', content: { type: 'text', text: 'Read session session-xyz-123' } }],
    } as unknown as SessionUpdate)

    const mappedDone = mapSessionUpdate(completedUpdate, { messageId: 'msg_1' })
    const toolResult = mappedDone.find((e) => e.type === 'content_delta' && e.delta.type === 'tool_result')
    expect(toolResult).toBeDefined()
    if (toolResult?.type === 'content_delta' && toolResult.delta.type === 'tool_result') {
      expect(toolResult.delta.summary).not.toBe('Read session session-xyz-123')
      expect(toolResult.delta.summary).toBe(realMarkdownSession)
      expect(toolResult.delta.summary.length).toBeGreaterThan(4500)
    }
  })
})

