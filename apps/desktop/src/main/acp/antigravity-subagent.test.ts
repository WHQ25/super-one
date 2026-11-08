import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionUpdate } from '@agentclientprotocol/sdk'
import type { AgentEvent } from '@superone/shared/agent-types'
import { mapSessionUpdate } from './acp-event-map'
import {
  extractAntigravityElicitationQuestion,
  makeAntigravityElicitationResponse,
  makeAntigravityUserInputResponse,
  normalizeAntigravitySessionUpdate,
} from './antigravity-protocol'
import {
  extractAntigravityApiRetryEvent,
  isAntigravityCancelledChunk,
} from './antigravity-runtime-bridge'
import {
  clearUnflushedAntigravityWakeupReplay,
  disposeAntigravitySubagentTracker,
  extractParentWakeupProgress,
  extractSpawnedSubagentsFromParentTranscript,
  hasPendingAntigravitySubagentWakeup,
  hasUnflushedAntigravityWakeupReplay,
  noteAntigravitySubagentEvents,
  parseAntigravitySubagentTranscript,
  waitForAntigravitySubagentWakeup,
} from './antigravity-subagent'

const tempDirs: string[] = []

function makeTempBrainRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'superone-agy-subagent-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  disposeAntigravitySubagentTracker()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('antigravity invoke_subagent normalization and transcript lifecycle', () => {
  it('normalizes Run invoke_subagent into Agent tool_use and preserves input across sparse completion', () => {
    const startUpdate = normalizeAntigravitySessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'call_sub_1',
      title: 'Run invoke_subagent',
      kind: 'other',
      status: 'in_progress',
      rawInput: {
        TypeName: 'image-generator',
        Role: 'Test Image Generator',
        Prompt: 'Generate a minimalist neon cat icon.',
      },
    } as SessionUpdate)

    const startEvents = mapSessionUpdate(startUpdate, 'msg-1', () => undefined)
    expect(startEvents).toEqual([
      {
        type: 'content_delta',
        messageId: undefined,
        delta: {
          type: 'tool_use',
          toolUseId: 'call_sub_1',
          toolName: 'Agent',
          input: JSON.stringify({
            description: 'Test Image Generator',
            subagent_type: 'image-generator',
            prompt: 'Generate a minimalist neon cat icon.',
            run_in_background: true,
          }),
          status: 'streaming',
          toolFilePath: undefined,
          toolSummary: 'Test Image Generator',
        },
      },
    ])

    const completedUpdate = normalizeAntigravitySessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call_sub_1',
      status: 'completed',
      rawOutput: '',
    } as SessionUpdate)

    const completedEvents = mapSessionUpdate(completedUpdate, 'msg-1', () => undefined)
    expect(completedEvents).toEqual([
      {
        type: 'content_delta',
        messageId: undefined,
        delta: {
          type: 'tool_use',
          toolUseId: 'call_sub_1',
          toolName: 'Agent',
          input: JSON.stringify({
            description: 'Test Image Generator',
            subagent_type: 'image-generator',
            prompt: 'Generate a minimalist neon cat icon.',
            run_in_background: true,
          }),
          status: 'complete',
          toolFilePath: undefined,
          toolSummary: 'Test Image Generator',
        },
      },
      {
        type: 'content_delta',
        messageId: undefined,
        delta: {
          type: 'tool_result',
          toolUseId: 'call_sub_1',
          summary: 'done',
          outputPath: undefined,
          isError: false,
        },
      },
    ])
  })

  it('extracts spawned subagent references from parent transcript.jsonl', () => {
    const parentRaw = [
      JSON.stringify({
        step_index: 23,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: '2026-11-08T03:58:56.835584Z',
        tool_calls: [
          {
            id: 'call_sub_1',
            name: 'invoke_subagent',
            args: {
              Prompt: '"Generate icon"',
              Role: '"Test Image Generator"',
              TypeName: '"image-generator"',
            },
          },
        ],
      }),
      JSON.stringify({
        step_index: 24,
        type: 'GENERIC',
        status: 'DONE',
        created_at: '2026-11-08T03:58:57.145184Z',
        content:
          'Created At: 2026-11-08T11:58:56+08:00\nCompleted At: 2026-11-08T11:58:57+08:00\n\nCreated the following subagent:\n{\n  "conversationId": "4852c4a5-200b-4d11-86f9-e7a5532f092e",\n  "logAbsoluteUri": "file:///Users/test/.gemini/antigravity-cli/brain/4852c4a5-200b-4d11-86f9-e7a5532f092e/.system_generated/logs/transcript.jsonl"\n}',
      }),
    ].join('\n')

    const refs = extractSpawnedSubagentsFromParentTranscript(parentRaw)
    expect(refs).toHaveLength(1)
    expect(refs[0]?.conversationId).toBe('4852c4a5-200b-4d11-86f9-e7a5532f092e')
    expect(refs[0]?.outputFile).toBe(
      '/Users/test/.gemini/antigravity-cli/brain/4852c4a5-200b-4d11-86f9-e7a5532f092e/.system_generated/logs/transcript.jsonl',
    )
  })

  it('parses subagent transcript and emits task lifecycle + gallery tool_result', () => {
    const brainRoot = makeTempBrainRoot()
    const parentSid = 'parent-session-1'
    const subSid = 'subagent-session-1'
    const parentLogsDir = join(brainRoot, parentSid, '.system_generated', 'logs')
    const subLogsDir = join(brainRoot, subSid, '.system_generated', 'logs')
    mkdirSync(parentLogsDir, { recursive: true })
    mkdirSync(subLogsDir, { recursive: true })

    const subTranscriptPath = join(subLogsDir, 'transcript.jsonl')
    const savedImagePath = join(brainRoot, subSid, 'neon_cat.jpg')

    writeFileSync(
      join(parentLogsDir, 'transcript.jsonl'),
      JSON.stringify({
        step_index: 5,
        type: 'GENERIC',
        status: 'DONE',
        created_at: new Date().toISOString(),
        content: `Created the following subagent:\n${JSON.stringify({
          conversationId: subSid,
          logAbsoluteUri: `file://${subTranscriptPath}`,
        })}`,
      }) + '\n',
      'utf8',
    )

    const subRaw = [
      JSON.stringify({
        step_index: 4,
        type: 'USER_INPUT',
        status: 'DONE',
        created_at: '2026-11-08T03:58:56.854496Z',
        content: 'Generate a minimalist neon cat icon.',
      }),
      JSON.stringify({
        step_index: 6,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: '2026-11-08T03:59:00.880970Z',
        thinking: 'Generating neon cat icon.',
        input_tokens: 9103,
        output_tokens: 80,
        tool_calls: [
          {
            id: 'img_call_1',
            name: 'generate_image',
            args: {
              ImageName: '"neon_cat"',
              Prompt: '"Minimalist neon cat icon"',
            },
          },
        ],
      }),
      JSON.stringify({
        step_index: 7,
        type: 'GENERIC',
        status: 'DONE',
        created_at: '2026-11-08T03:59:18.920998Z',
        content: `Created At: 2026-11-08T11:59:00+08:00\nCompleted At: 2026-11-08T11:59:18+08:00\n\nGenerated image is saved at ${savedImagePath}.`,
        media: [{ mime_type: 'image/jpeg', uri: savedImagePath }],
      }),
      JSON.stringify({
        step_index: 8,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: '2026-11-08T03:59:21.741845Z',
        input_tokens: 9443,
        output_tokens: 85,
        tool_calls: [
          {
            id: 'msg_call_1',
            name: 'send_message',
            args: {
              Message: `"Generated and saved at ${savedImagePath}"`,
              Recipient: `"${parentSid}"`,
            },
          },
        ],
      }),
      JSON.stringify({
        step_index: 9,
        type: 'GENERIC',
        status: 'DONE',
        created_at: '2026-11-08T03:59:21.746000Z',
        content: 'Message sent.',
      }),
      JSON.stringify({
        step_index: 10,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: '2026-11-08T03:59:24.100000Z',
        input_tokens: 9529,
        output_tokens: 18,
      }),
    ].join('\n')

    writeFileSync(subTranscriptPath, subRaw, 'utf8')

    const parsed = parseAntigravitySubagentTranscript(subRaw)
    expect(parsed.completed).toBe(true)
    expect(parsed.failed).toBe(false)
    expect(parsed.toolUses).toBe(2)
    expect(parsed.inputTokens).toBe(9529)
    expect(parsed.outputTokens).toBe(80 + 85 + 18)
    expect(parsed.savedImagePaths).toEqual([savedImagePath])
    expect(parsed.resultText).toBe(`Generated and saved at ${savedImagePath}`)

    const emitted: AgentEvent[] = []
    noteAntigravitySubagentEvents(
      parentSid,
      'msg-1',
      [
        {
          type: 'content_delta',
          messageId: 'msg-1',
          delta: {
            type: 'tool_use',
            toolUseId: 'call_sub_1',
            toolName: 'Agent',
            input: JSON.stringify({
              subagent_type: 'image-generator',
              description: 'Test Image Generator',
              prompt: 'Generate a minimalist neon cat icon.',
              run_in_background: true,
            }),
          },
        },
      ],
      (ev) => emitted.push(ev),
      [brainRoot],
    )

    expect(emitted.some((e) => e.type === 'task_started' && e.taskId === subSid && e.outputFile === subTranscriptPath)).toBe(true)
    expect(emitted.some((e) => e.type === 'subagent_usage' && e.parentToolUseId === 'call_sub_1')).toBe(true)
    expect(emitted.some((e) => e.type === 'task_progress' && e.toolUseId === 'call_sub_1')).toBe(true)
    expect(
      emitted.some(
        (e) =>
          e.type === 'content_delta' &&
          e.delta.type === 'tool_result' &&
          e.delta.toolUseId === 'call_sub_1' &&
          e.delta.summary.includes(savedImagePath),
      ),
    ).toBe(true)
    expect(
      emitted.some(
        (e) =>
          e.type === 'task_notification' &&
          e.toolUseId === 'call_sub_1' &&
          e.taskStatus === 'completed' &&
          e.resultText === `Generated and saved at ${savedImagePath}`,
      ),
    ).toBe(true)
  })

  it('converts Antigravity transient API error chunks and drops client cancellation chunks instead of writing chat text', () => {
    const retryUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: {
        type: 'text',
        text: '\n⚠️ API error (attempt 1): request failed: Post "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse": unexpected EOF\n',
      },
    }
    expect(extractAntigravityApiRetryEvent(retryUpdate)).toEqual({
      type: 'api_retry',
      attempt: 1,
      delayMs: 0,
      message:
        'API error (attempt 1): request failed: Post "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse": unexpected EOF',
      phase: 'retrying',
    })

    const plainWarningRetryUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: {
        type: 'text',
        text: '\u26a0 API error (attempt 1): request failed: Post "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse": EOF',
      },
    }
    expect(extractAntigravityApiRetryEvent(plainWarningRetryUpdate)).toEqual({
      type: 'api_retry',
      attempt: 1,
      delayMs: 0,
      message:
        'API error (attempt 1): request failed: Post "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse": EOF',
      phase: 'retrying',
    })
    expect(
      mapSessionUpdate(plainWarningRetryUpdate as SessionUpdate, { messageId: 'msg-1' }),
    ).toEqual([
      {
        type: 'api_retry',
        attempt: 1,
        delayMs: 0,
        message:
          'API error (attempt 1): request failed: Post "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse": EOF',
        phase: 'retrying',
      },
    ])

    const cancelledClientUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: {
        type: 'text',
        text: '\nThe request was cancelled by the client.\n',
      },
    }
    expect(isAntigravityCancelledChunk(cancelledClientUpdate)).toBe(true)
    expect(
      mapSessionUpdate(cancelledClientUpdate as SessionUpdate, { messageId: 'msg-1' }),
    ).toEqual([])

    const cancelledTrajectoryUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: {
        type: 'text',
        text: 'Trajectory was cancelled.',
      },
    }
    expect(isAntigravityCancelledChunk(cancelledTrajectoryUpdate)).toBe(true)
    expect(
      mapSessionUpdate(cancelledTrajectoryUpdate as SessionUpdate, { messageId: 'msg-1' }),
    ).toEqual([])

    const normalUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: {
        type: 'text',
        text: 'Normal assistant response text.',
      },
    }
    expect(extractAntigravityApiRetryEvent(normalUpdate)).toBeNull()
    expect(isAntigravityCancelledChunk(normalUpdate)).toBe(false)
  })

  it('normalizes Run ask_question into AskUserQuestion and formats answered Q&A summary', () => {
    const rawQ = [{ question: 'Which environment should we deploy to?', options: ['Staging', 'Production'], is_multi_select: false }]
    const startUpdate = normalizeAntigravitySessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'call_ask_1',
      title: 'Run ask_question',
      kind: 'other',
      status: 'in_progress',
      rawInput: { questions: rawQ },
    } as SessionUpdate)

    expect(mapSessionUpdate(startUpdate, 'msg-1', () => undefined)).toEqual([
      {
        type: 'content_delta',
        messageId: undefined,
        delta: {
          type: 'tool_use',
          toolUseId: 'call_ask_1',
          toolName: 'AskUserQuestion',
          input: JSON.stringify({
            questions: [{
              question: 'Which environment should we deploy to?',
              header: 'Which environment should…',
              options: [{ label: 'Staging', description: '' }, { label: 'Production', description: '' }],
              multiSelect: false,
            }],
          }),
          status: 'streaming',
          toolFilePath: undefined,
          toolSummary: undefined,
        },
      },
    ])

    makeAntigravityUserInputResponse(
      {
        sessionId: 'sess-1',
        toolCall: { toolCallId: 'call_ask_1', title: 'Run ask_question', rawInput: { questions: rawQ } },
        options: [
          { optionId: '0', name: 'Staging', kind: 'allow_once' },
          { optionId: '1', name: 'Production', kind: 'allow_once' },
        ],
      },
      { answers: { call_ask_1: 'Production' } },
    )

    const completedUpdate = normalizeAntigravitySessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call_ask_1',
      status: 'completed',
      rawOutput: '',
    } as SessionUpdate)

    expect(mapSessionUpdate(completedUpdate, 'msg-1', () => undefined)).toEqual([
      {
        type: 'content_delta',
        messageId: undefined,
        delta: {
          type: 'tool_result',
          toolUseId: 'call_ask_1',
          summary: '"Which environment should we deploy to?"="Production"',
          outputPath: undefined,
          isError: false,
        },
      },
    ])
  })

  it('extracts and answers Antigravity elicitation/create form requests', () => {
    const elicitationParams = {
      sessionId: 'sess-1',
      toolCallId: '14',
      mode: 'form',
      message: 'The agent has 2 questions.',
      requestedSchema: {
        type: 'object',
        properties: {
          q1: {
            type: 'string',
            description: 'Which environment should we deploy to?',
            oneOf: [{ const: 'opt_staging', title: 'Staging' }, { const: 'opt_prod', title: 'Production' }],
          },
          q1_other: { type: 'string', title: 'Other' },
          q2: {
            type: 'array',
            description: 'Which features should be enabled?',
            items: { anyOf: [{ const: 'feat_sso', title: 'SSO' }, { const: 'feat_audit', title: 'Audit logs' }] },
          },
          q2_other: { type: 'string', title: 'Other' },
        },
      },
    }

    expect(extractAntigravityElicitationQuestion(elicitationParams)).toEqual({
      sessionId: 'sess-1',
      toolCallId: '14',
      questions: [
        {
          id: 'q1',
          header: 'Question',
          question: 'Which environment should we deploy to?',
          multiSelect: false,
          options: [{ label: 'Staging', description: '' }, { label: 'Production', description: '' }],
        },
        {
          id: 'q2',
          header: 'Question',
          question: 'Which features should be enabled?',
          multiSelect: true,
          options: [{ label: 'SSO', description: '' }, { label: 'Audit logs', description: '' }],
        },
      ],
    })

    expect(
      makeAntigravityElicitationResponse(elicitationParams, {
        outcome: 'accepted',
        answers: {
          'Which environment should we deploy to?': ['Production'],
          'Which features should be enabled?': ['SSO', 'Custom webhook'],
        },
      }),
    ).toEqual({
      action: 'accept',
      content: { q1: 'opt_prod', q2: ['feat_sso'], q2_other: 'Custom webhook' },
    })

    const completedUpdate = normalizeAntigravitySessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: '14',
      status: 'completed',
      rawOutput: 'A1: Production',
    } as SessionUpdate)
    expect(mapSessionUpdate(completedUpdate, 'msg-1', () => undefined)).toEqual([
      {
        type: 'content_delta',
        messageId: undefined,
        delta: {
          type: 'tool_result',
          toolUseId: '14',
          summary:
            '"Which environment should we deploy to?"="Production", "Which features should be enabled?"="SSO, Custom webhook"',
          outputPath: undefined,
          isError: false,
        },
      },
    ])
  })

  it('normalizes agy 1.5.3 Subagents array input and extracts plural Created the following subagents', () => {
    const startUpdate = normalizeAntigravitySessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'call_sub_plural',
      title: 'Test Image Generator',
      name: 'invoke_subagent',
      kind: 'other',
      status: 'in_progress',
      rawInput: {
        Subagents: [
          {
            TypeName: 'image-generator',
            Role: 'Test Image Generator',
            Prompt: 'Generate a cyber shiba icon.',
            Model: 'inherit',
          },
        ],
        toolAction: 'Invoking subagent',
        toolSummary: 'Subagent invocation',
      },
    } as unknown as SessionUpdate)

    const startEvents = mapSessionUpdate(startUpdate, 'msg-1', () => undefined)
    expect(startEvents).toHaveLength(1)
    expect(startEvents[0]).toMatchObject({
      type: 'content_delta',
      delta: {
        type: 'tool_use',
        toolUseId: 'call_sub_plural',
        toolName: 'Agent',
        status: 'streaming',
        toolSummary: 'Test Image Generator',
      },
    })
    const parsedInput = JSON.parse((startEvents[0] as Extract<AgentEvent, { type: 'content_delta' }>).delta.type === 'tool_use'
      ? ((startEvents[0] as Extract<AgentEvent, { type: 'content_delta' }>).delta as { input: string }).input
      : '{}') as Record<string, unknown>
    expect(parsedInput).toMatchObject({
      subagent_type: 'image-generator',
      description: 'Test Image Generator',
      prompt: 'Generate a cyber shiba icon.',
      run_in_background: true,
    })

    const pluralRaw = JSON.stringify({
      step_index: 952,
      type: 'GENERIC',
      status: 'DONE',
      created_at: '2026-11-08T09:42:06.100000Z',
      content:
        'Created At: 2026-11-08T17:42:05+08:00\nCompleted At: 2026-11-08T17:42:06+08:00\n\nCreated the following subagents:\n[\n  {\n    "conversationId": "006f5d57-0bd4-4c6e-8126-50bd61dc08e3",\n    "logAbsoluteUri": "file:///Users/test/.gemini/antigravity-cli/brain/006f5d57-0bd4-4c6e-8126-50bd61dc08e3/.system_generated/logs/transcript.jsonl"\n  }\n]',
    })
    const refs = extractSpawnedSubagentsFromParentTranscript(pluralRaw)
    expect(refs).toEqual([
      {
        conversationId: '006f5d57-0bd4-4c6e-8126-50bd61dc08e3',
        outputFile:
          '/Users/test/.gemini/antigravity-cli/brain/006f5d57-0bd4-4c6e-8126-50bd61dc08e3/.system_generated/logs/transcript.jsonl',
        stepIndex: 952,
        createdAtMs: Date.parse('2026-11-08T09:42:06.100000Z'),
      },
    ])
  })

  it('streams post-subagent SYSTEM_MESSAGE + PLANNER_RESPONSE wakeup from parent transcript and tracks replay suppression', async () => {
    const brainRoot = makeTempBrainRoot()
    const parentSid = 'parent-wakeup-session'
    const subSid = 'child-wakeup-session'
    const parentLogsDir = join(brainRoot, parentSid, '.system_generated', 'logs')
    const subLogsDir = join(brainRoot, subSid, '.system_generated', 'logs')
    mkdirSync(parentLogsDir, { recursive: true })
    mkdirSync(subLogsDir, { recursive: true })

    const parentFullTranscriptPath = join(parentLogsDir, 'transcript_full.jsonl')
    const subTranscriptPath = join(subLogsDir, 'transcript.jsonl')
    const nowIso = new Date().toISOString()

    // Initial parent transcript up to Step 953 (pre-subagent turn end)
    const initialParentLines = [
      JSON.stringify({
        step_index: 950,
        type: 'USER_INPUT',
        status: 'DONE',
        created_at: nowIso,
        content: 'Run a background subagent to generate an icon.',
      }),
      JSON.stringify({
        step_index: 951,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: nowIso,
        thinking: 'Spawning image-generator subagent.',
        input_tokens: 11859,
        output_tokens: 132,
        cache_read_tokens: 10035,
        tool_calls: [
          {
            id: 'call_sub_951',
            name: 'invoke_subagent',
            args: {
              TypeName: '"image-generator"',
              Role: '"Test Image Generator"',
              Prompt: '"Generate icon"',
            },
          },
        ],
      }),
      JSON.stringify({
        step_index: 952,
        type: 'GENERIC',
        status: 'DONE',
        created_at: nowIso,
        content: `Created the following subagent:\n${JSON.stringify({
          conversationId: subSid,
          logAbsoluteUri: `file://${subTranscriptPath}`,
        })}`,
      }),
      JSON.stringify({
        step_index: 953,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: nowIso,
        thinking: 'Waiting for subagent to complete.',
        content: '`image-generator` 子智能体已在后台启动，我会在完成后汇报。',
        input_tokens: 12078,
        output_tokens: 89,
        cache_read_tokens: 11583,
      }),
    ]
    writeFileSync(parentFullTranscriptPath, `${initialParentLines.join('\n')}\n`, 'utf8')

    // Child subagent initially running
    writeFileSync(
      subTranscriptPath,
      `${JSON.stringify({
        step_index: 1,
        type: 'USER_INPUT',
        status: 'DONE',
        created_at: nowIso,
        content: 'Generate icon',
      })}\n`,
      'utf8',
    )

    const emitted: AgentEvent[] = []
    noteAntigravitySubagentEvents(
      parentSid,
      'msg-wakeup-1',
      [
        {
          type: 'content_delta',
          messageId: 'msg-wakeup-1',
          delta: {
            type: 'tool_use',
            toolUseId: 'call_sub_951',
            toolName: 'Agent',
            input: JSON.stringify({
              subagent_type: 'image-generator',
              description: 'Test Image Generator',
              prompt: 'Generate icon',
              run_in_background: true,
            }),
          },
        },
      ],
      (ev) => emitted.push(ev),
      [brainRoot],
    )

    expect(hasPendingAntigravitySubagentWakeup(parentSid)).toBe(true)
    expect(hasUnflushedAntigravityWakeupReplay(parentSid)).toBe(false)

    // Simulate parent turn ending at Step 953 and waiting for wakeup
    const waitPromise = waitForAntigravitySubagentWakeup(parentSid)

    // Subagent completes and parent writes Step 954 (SYSTEM_MESSAGE) + Step 955 (PLANNER_RESPONSE)
    writeFileSync(
      subTranscriptPath,
      [
        JSON.stringify({
          step_index: 1,
          type: 'USER_INPUT',
          status: 'DONE',
          created_at: nowIso,
          content: 'Generate icon',
        }),
        JSON.stringify({
          step_index: 2,
          type: 'PLANNER_RESPONSE',
          status: 'DONE',
          created_at: nowIso,
          input_tokens: 5000,
          output_tokens: 50,
          content: 'Icon generated.',
        }),
      ].join('\n') + '\n',
      'utf8',
    )

    const wakeupParentLines = [
      ...initialParentLines,
      JSON.stringify({
        step_index: 954,
        type: 'SYSTEM_MESSAGE',
        status: 'DONE',
        created_at: nowIso,
        content: `<SYSTEM_MESSAGE>\n[Message]\nIcon generated.\nsender=${subSid}\n</SYSTEM_MESSAGE>`,
      }),
      JSON.stringify({
        step_index: 955,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: nowIso,
        thinking: 'The subagent finished generating the cyber shiba icon.',
        thinking_duration: '1.6s',
        content: '`image-generator` 子智能体已完成图标生成。',
        input_tokens: 13537,
        output_tokens: 258,
        cache_read_tokens: 11583,
      }),
    ]
    writeFileSync(parentFullTranscriptPath, `${wakeupParentLines.join('\n')}\n`, 'utf8')

    const progress = extractParentWakeupProgress(`${wakeupParentLines.join('\n')}\n`, 952)
    expect(progress.sawSystemMessage).toBe(true)
    expect(progress.completed).toBe(true)
    expect(progress.steps).toHaveLength(1)
    expect(progress.steps[0]?.stepIndex).toBe(955)

    const outcome = await waitPromise
    expect(outcome).toBe('completed')
    expect(hasPendingAntigravitySubagentWakeup(parentSid)).toBe(false)
    expect(hasUnflushedAntigravityWakeupReplay(parentSid)).toBe(true)

    expect(
      emitted.some(
        (e) =>
          e.type === 'content_delta' &&
          e.messageId === 'msg-wakeup-1' &&
          e.delta.type === 'thinking' &&
          e.delta.id === 'agy_wakeup_think_955' &&
          e.delta.thinking === 'The subagent finished generating the cyber shiba icon.',
      ),
    ).toBe(true)
    expect(
      emitted.some(
        (e) =>
          e.type === 'content_delta' &&
          e.messageId === 'msg-wakeup-1' &&
          e.delta.type === 'text' &&
          e.delta.id === 'agy_wakeup_text_955' &&
          e.delta.text === '`image-generator` 子智能体已完成图标生成。',
      ),
    ).toBe(true)
    expect(
      emitted.some(
        (e) =>
          e.type === 'message_usage' &&
          e.messageId === 'msg-wakeup-1' &&
          e.inputTokens === (11859 - 10035) + (12078 - 11583) + (13537 - 11583) &&
          e.outputTokens === 132 + 89 + 258 &&
          e.cacheReadTokens === 10035 + 11583 + 11583 &&
          e.contextTokens === 13537 + 258,
      ),
    ).toBe(true)

    clearUnflushedAntigravityWakeupReplay(parentSid)
    expect(hasUnflushedAntigravityWakeupReplay(parentSid)).toBe(false)
  })
})
