import { describe, it, expect } from 'vitest'
import { applyClaudeEventToRuntime, createClaudeRuntime, extractResultText, buildUserMessage, extractClaudeTitle } from './claude-session-runtime'
import type { AgentEvent, ChatMessage, SendMessageRequest } from '@superone/shared/agent-types'

function makeRuntime(messages: ChatMessage[]) {
  return createClaudeRuntime('/test', 'sess-1', { messages })
}

function agentMessage(toolUseId: string): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    status: 'streaming',
    content: [
      { type: 'tool_use', toolName: 'Agent', toolUseId, input: '{"run_in_background":true}' },
    ],
    createdAt: '',
    providerId: 'claude',
  }
}

function getAgentBlock(runtime: ReturnType<typeof createClaudeRuntime>, toolUseId: string) {
  for (const msg of runtime.messages) {
    for (const block of msg.content) {
      if (block.type === 'tool_use' && block.toolUseId === toolUseId) return block
    }
  }
  return null
}

describe('applyClaudeEventToRuntime task events', () => {
  const TID = 'toolu_0167ioZRcAwRefQPx1BR68Cj'

  it('task_started initializes taskProgress entry', () => {
    let rt = makeRuntime([agentMessage(TID)])
    rt = applyClaudeEventToRuntime(rt, {
      type: 'task_started',
      taskId: 'a1aadbabbdc64b4a3',
      toolUseId: TID,
      description: 'Explore exit plan mode UI',
    } as AgentEvent)

    expect(rt.taskProgress[TID]).toEqual({
      description: 'Explore exit plan mode UI',
      taskId: 'a1aadbabbdc64b4a3',
      lastToolName: undefined,
      summary: undefined,
      totalTokens: 0,
      toolUses: 0,
      durationMs: 0,
      toolHistory: [],
    })
  })

  it('task_progress patches Agent block with taskUsage and taskToolHistory', () => {
    let rt = makeRuntime([agentMessage(TID)])
    rt = applyClaudeEventToRuntime(rt, {
      type: 'task_started',
      taskId: 'a1aadbabbdc64b4a3',
      toolUseId: TID,
      description: 'Explore exit plan mode UI',
    } as AgentEvent)
    rt = applyClaudeEventToRuntime(rt, {
      type: 'task_progress',
      taskId: 'a1aadbabbdc64b4a3',
      toolUseId: TID,
      description: 'Searching for PlanApproval',
      lastToolName: 'Grep',
      usage: { totalTokens: 14450, toolUses: 1, durationMs: 6722 },
    } as AgentEvent)

    const block = getAgentBlock(rt, TID)
    expect(block).not.toBeNull()
    expect(block!.taskUsage).toEqual({ totalTokens: 14450, toolUses: 1, durationMs: 6722 })
    expect(block!.taskToolHistory).toEqual([
      { toolName: '', description: 'Explore exit plan mode UI' },
    ])
  })

  it('task_progress accumulates toolHistory across multiple events', () => {
    let rt = makeRuntime([agentMessage(TID)])
    rt = applyClaudeEventToRuntime(rt, {
      type: 'task_started', taskId: 't1', toolUseId: TID, description: 'step 1',
    } as AgentEvent)
    rt = applyClaudeEventToRuntime(rt, {
      type: 'task_progress', taskId: 't1', toolUseId: TID,
      description: 'step 2', lastToolName: 'Grep',
      usage: { totalTokens: 100, toolUses: 1, durationMs: 500 },
    } as AgentEvent)
    rt = applyClaudeEventToRuntime(rt, {
      type: 'task_progress', taskId: 't1', toolUseId: TID,
      description: 'step 3', lastToolName: 'Read',
      usage: { totalTokens: 200, toolUses: 2, durationMs: 1000 },
    } as AgentEvent)

    const block = getAgentBlock(rt, TID)
    expect(block!.taskToolHistory).toEqual([
      { toolName: '', description: 'step 1' },
      { toolName: 'Grep', description: 'step 2' },
    ])
    expect(block!.taskUsage).toEqual({ totalTokens: 200, toolUses: 2, durationMs: 1000 })
  })

  it('task_notification writes final state to Agent block', () => {
    let rt = makeRuntime([agentMessage(TID)])
    rt = applyClaudeEventToRuntime(rt, {
      type: 'task_started', taskId: 't1', toolUseId: TID, description: 'starting',
    } as AgentEvent)
    rt = applyClaudeEventToRuntime(rt, {
      type: 'task_progress', taskId: 't1', toolUseId: TID,
      description: 'reading files', lastToolName: 'Read',
      usage: { totalTokens: 14450, toolUses: 1, durationMs: 6722 },
    } as AgentEvent)
    rt = applyClaudeEventToRuntime(rt, {
      type: 'task_notification', taskId: 't1', toolUseId: TID,
      taskStatus: 'completed',
      summary: 'Agent "Explore exit plan mode UI" completed',
      usage: { totalTokens: 42601, toolUses: 17, durationMs: 133971 },
    } as AgentEvent)

    const block = getAgentBlock(rt, TID)
    expect(block!.taskUsage).toEqual({ totalTokens: 42601, toolUses: 17, durationMs: 133971 })
    expect(block!.taskSummary).toBe('Agent "Explore exit plan mode UI" completed')
    expect(block!.taskToolHistory).toEqual([
      { toolName: '', description: 'starting' },
    ])
  })

  it('task data persists in block even without task_notification (interrupt case)', () => {
    let rt = makeRuntime([agentMessage(TID)])
    rt = applyClaudeEventToRuntime(rt, {
      type: 'task_started', taskId: 't1', toolUseId: TID, description: 'step 1',
    } as AgentEvent)
    rt = applyClaudeEventToRuntime(rt, {
      type: 'task_progress', taskId: 't1', toolUseId: TID,
      description: 'step 2', lastToolName: 'Bash',
      summary: 'partial work',
      usage: { totalTokens: 100, toolUses: 2, durationMs: 500 },
    } as AgentEvent)

    const block = getAgentBlock(rt, TID)
    expect(block!.taskUsage).toEqual({ totalTokens: 100, toolUses: 2, durationMs: 500 })
    expect(block!.taskToolHistory).toEqual([{ toolName: '', description: 'step 1' }])
    expect(block!.taskSummary).toBe('partial work')
  })

  it('task_notification sets outputPath on tool_result block', () => {
    const msg: ChatMessage = {
      id: 'msg-1', role: 'assistant', status: 'streaming',
      content: [
        { type: 'tool_use', toolName: 'Agent', toolUseId: TID, input: '' },
        { type: 'tool_result', toolUseId: TID, summary: 'done' },
      ],
      createdAt: '', providerId: 'claude',
    }
    let rt = makeRuntime([msg])
    rt = applyClaudeEventToRuntime(rt, {
      type: 'task_notification', taskId: 't1', toolUseId: TID,
      taskStatus: 'completed', summary: 'done',
      outputFile: '/tmp/output.md',
      usage: { totalTokens: 100, toolUses: 1, durationMs: 500 },
    } as AgentEvent)

    const resultBlock = rt.messages[0].content.find(
      (b) => b.type === 'tool_result' && b.toolUseId === TID,
    )
    expect(resultBlock).toBeDefined()
    if (resultBlock?.type === 'tool_result') {
      expect(resultBlock.outputPath).toBe('/tmp/output.md')
    }
  })

  it('task_notification reads outputFile and persists taskResultText', () => {
    const { writeFileSync, mkdtempSync, rmSync } = require('node:fs')
    const { join } = require('node:path')
    const { tmpdir } = require('node:os')
    const dir = mkdtempSync(join(tmpdir(), 'rt-test-'))
    const file = join(dir, 'output.jsonl')
    const jsonl = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Grep","input":{"pattern":"foo"}}]}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Here is the final result."}]}}',
    ].join('\n')
    writeFileSync(file, jsonl)

    try {
      let rt = makeRuntime([agentMessage(TID)])
      rt = applyClaudeEventToRuntime(rt, {
        type: 'task_started', taskId: 't1', toolUseId: TID, description: 'exploring',
      } as AgentEvent)
      rt = applyClaudeEventToRuntime(rt, {
        type: 'task_notification', taskId: 't1', toolUseId: TID,
        taskStatus: 'completed', summary: 'done',
        outputFile: file,
        usage: { totalTokens: 500, toolUses: 5, durationMs: 3000 },
      } as AgentEvent)

      const block = getAgentBlock(rt, TID)
      expect(block!.taskResultText).toBe('Here is the final result.')
    } finally {
      rmSync(dir, { recursive: true })
    }
  })

  it('task_notification without outputFile has no taskResultText', () => {
    let rt = makeRuntime([agentMessage(TID)])
    rt = applyClaudeEventToRuntime(rt, {
      type: 'task_notification', taskId: 't1', toolUseId: TID,
      taskStatus: 'completed', summary: 'done',
      usage: { totalTokens: 100, toolUses: 1, durationMs: 500 },
    } as AgentEvent)

    const block = getAgentBlock(rt, TID)
    expect(block!.taskResultText).toBeUndefined()
  })
})

describe('message_start is an idempotent upsert', () => {
  it('keeps the existing message intact when a duplicate-id message_start arrives (stub must not overwrite accumulated content)', () => {
    const completed: ChatMessage = {
      id: 'msg-1',
      role: 'assistant',
      status: 'complete',
      content: [
        { type: 'text', text: 'finished reply' },
        { type: 'tool_use', toolName: 'Read', toolUseId: 'tu-1', input: '{}' },
      ],
      createdAt: '2024-01-01T00:00:00.000Z',
      providerId: 'claude',
      metadata: { durationMs: 57000, costUsd: 0.01 },
    }
    let rt = createClaudeRuntime('/test', 'sess-1', { messages: [completed] })

    rt = applyClaudeEventToRuntime(rt, {
      type: 'message_start',
      message: {
        id: 'msg-1',
        role: 'assistant',
        status: 'streaming',
        content: [],
        createdAt: '2024-01-01T00:01:00.000Z',
        providerId: 'claude',
      },
    } as AgentEvent)

    const after = rt.messages.find((m) => m.id === 'msg-1')!
    expect(after.content).toEqual(completed.content)
    expect(after.status).toBe('complete')
    expect(after.metadata).toEqual({ durationMs: 57000, costUsd: 0.01 })
  })
})

describe('message_timestamp', () => {
  it('patches createdAt when the SDK origin timestamp arrives', () => {
    let rt = createClaudeRuntime('/test', 'sess-1', {
      messages: [{
        id: 'msg-1',
        role: 'assistant',
        status: 'streaming',
        content: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        providerId: 'claude',
      }],
    })
    rt = applyClaudeEventToRuntime(rt, {
      type: 'message_timestamp',
      messageId: 'msg-1',
      timestamp: '2024-01-01T00:00:01.500Z',
    } as AgentEvent)
    expect(rt.messages.find((m) => m.id === 'msg-1')!.createdAt).toBe('2024-01-01T00:00:01.500Z')
  })

  it('ignores timestamps for unknown message ids', () => {
    let rt = createClaudeRuntime('/test', 'sess-1', {
      messages: [{
        id: 'msg-1',
        role: 'assistant',
        status: 'streaming',
        content: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        providerId: 'claude',
      }],
    })
    rt = applyClaudeEventToRuntime(rt, {
      type: 'message_timestamp',
      messageId: 'msg-missing',
      timestamp: '2024-01-01T00:00:01.500Z',
    } as AgentEvent)
    expect(rt.messages.find((m) => m.id === 'msg-1')!.createdAt).toBe('2024-01-01T00:00:00.000Z')
  })
})

describe('content_delta never leaks subagent text/thinking into the main agent', () => {
  function emptyAssistant(): ChatMessage {
    return { id: 'msg-1', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' }
  }
  function delta(rt: ReturnType<typeof createClaudeRuntime>, d: Record<string, unknown>) {
    return applyClaudeEventToRuntime(rt, { type: 'content_delta', messageId: 'msg-1', delta: d } as AgentEvent)
  }

  it('keeps a subagent text stream attributed and out of the top-level text block when streams interleave', () => {
    let rt = createClaudeRuntime('/test', 'sess-1', { messages: [emptyAssistant()] })
    // Top-level agent and a running sub-agent stream concurrently into one message.
    rt = delta(rt, { type: 'text', text: 'Top ', parentToolUseId: null })
    rt = delta(rt, { type: 'text', text: 'subagent reply', parentToolUseId: 'toolu_sub' })
    rt = delta(rt, { type: 'text', text: 'level done', parentToolUseId: null })

    const content = rt.messages.find((m) => m.id === 'msg-1')!.content
    const top = content.filter((b) => b.type === 'text' && (b as { parentToolUseId?: string | null }).parentToolUseId === null)
    const sub = content.filter((b) => b.type === 'text' && (b as { parentToolUseId?: string }).parentToolUseId === 'toolu_sub')
    expect(top).toHaveLength(1)
    expect((top[0] as { text: string }).text).toBe('Top level done')
    expect(sub).toHaveLength(1)
    expect((sub[0] as { text: string }).text).toBe('subagent reply')
  })

  it('does not fold a subagent thinking delta into the top-level agent thinking block', () => {
    let rt = createClaudeRuntime('/test', 'sess-1', { messages: [emptyAssistant()] })
    rt = delta(rt, { type: 'thinking', thinking: 'Top-level reasoning', parentToolUseId: null, startedAt: 1000, endedAt: 1000 })
    rt = delta(rt, { type: 'thinking', thinking: 'Subagent reasoning', parentToolUseId: 'toolu_sub', startedAt: 1500, endedAt: 1500 })

    const content = rt.messages.find((m) => m.id === 'msg-1')!.content
    const top = content.filter((b) => b.type === 'thinking' && (b as { parentToolUseId?: string | null }).parentToolUseId === null)
    const sub = content.filter((b) => b.type === 'thinking' && (b as { parentToolUseId?: string }).parentToolUseId === 'toolu_sub')
    expect(top).toHaveLength(1)
    expect((top[0] as { thinking: string }).thinking).toBe('Top-level reasoning')
    expect(sub).toHaveLength(1)
    expect((sub[0] as { thinking: string }).thinking).toBe('Subagent reasoning')
  })
})

describe('extractResultText', () => {
  it('extracts last assistant text from JSONL', () => {
    const jsonl = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"first"}]}}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{}}]}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"final answer"}]}}',
    ].join('\n')
    expect(extractResultText(jsonl)).toBe('final answer')
  })

  it('returns undefined for empty input', () => {
    expect(extractResultText('')).toBeUndefined()
  })

  it('skips non-assistant lines', () => {
    const jsonl = '{"type":"system","message":{"content":[{"type":"text","text":"ignored"}]}}'
    expect(extractResultText(jsonl)).toBeUndefined()
  })

  it('handles malformed lines gracefully', () => {
    const jsonl = 'not json\n{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}'
    expect(extractResultText(jsonl)).toBe('ok')
  })
})

function userMsg(id: string, extra?: Partial<ChatMessage>): ChatMessage {
  return { id, role: 'user', content: [], status: 'complete', createdAt: '', providerId: 'claude', ...extra }
}
function assistantMsg(id: string): ChatMessage {
  return { id, role: 'assistant', content: [], status: 'complete', createdAt: '', providerId: 'claude' }
}

describe('checkpoint_captured', () => {
  it('assigns checkpointId to the user message before the assistant message', () => {
    const rt = makeRuntime([userMsg('u1'), assistantMsg('a1')])
    const updated = applyClaudeEventToRuntime(rt, {
      type: 'checkpoint_captured', messageId: 'a1', checkpointId: 'cp1', resumePointId: 'rp1',
    } as AgentEvent)
    expect(updated.messages[0].checkpointId).toBe('cp1')
    expect(updated.messages[0].resumePointId).toBe('rp1')
  })

  it('overwrites existing checkpointId (replay then new message)', () => {
    const rt = makeRuntime([userMsg('u1', { checkpointId: 'old' }), assistantMsg('a1')])
    const updated = applyClaudeEventToRuntime(rt, {
      type: 'checkpoint_captured', messageId: 'a1', checkpointId: 'new', resumePointId: 'rp2',
    } as AgentEvent)
    expect(updated.messages[0].checkpointId).toBe('new')
    expect(updated.messages[0].resumePointId).toBe('rp2')
  })

  it('falls back to last user message when assistant message is not found', () => {
    const rt = makeRuntime([userMsg('u1'), assistantMsg('a1')])
    const updated = applyClaudeEventToRuntime(rt, {
      type: 'checkpoint_captured', messageId: 'unknown', checkpointId: 'cp1', resumePointId: 'rp1',
    } as AgentEvent)
    expect(updated.messages[0].checkpointId).toBe('cp1')
  })

  it('returns runtime unchanged when there are no user messages', () => {
    const rt = makeRuntime([assistantMsg('a1')])
    const updated = applyClaudeEventToRuntime(rt, {
      type: 'checkpoint_captured', messageId: 'a1', checkpointId: 'cp1', resumePointId: 'rp1',
    } as AgentEvent)
    expect(updated).toBe(rt)
  })

  it('handles multiple turns with independent checkpoints', () => {
    const rt = makeRuntime([
      userMsg('u1'), assistantMsg('a1'),
      userMsg('u2'), assistantMsg('a2'),
    ])
    let updated = applyClaudeEventToRuntime(rt, {
      type: 'checkpoint_captured', messageId: 'a1', checkpointId: 'cp1', resumePointId: 'rp1',
    } as AgentEvent)
    updated = applyClaudeEventToRuntime(updated, {
      type: 'checkpoint_captured', messageId: 'a2', checkpointId: 'cp2', resumePointId: 'rp2',
    } as AgentEvent)
    expect(updated.messages[0].checkpointId).toBe('cp1')
    expect(updated.messages[2].checkpointId).toBe('cp2')
  })
})

describe('buildUserMessage (agent-agnostic constructor)', () => {
  function req(overrides?: Partial<SendMessageRequest>): SendMessageRequest {
    return { content: 'hello', clientMessageId: 'u-1', ...overrides }
  }

  it('builds a single text-block content from request.content when userMessageContent is omitted', () => {
    const msg = buildUserMessage(req(), 'local')
    expect(msg.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(msg.role).toBe('user')
    expect(msg.id).toBe('u-1')
  })

  it('uses request.userMessageContent verbatim when provided (preserves segments + isPaste)', () => {
    const msg = buildUserMessage(req({
      userMessageContent: [
        { type: 'text', text: 'before paste' },
        { type: 'text', text: 'pasted block', isPaste: true },
        { type: 'text', text: 'after paste' },
      ],
    }), 'local')
    expect(msg.content).toEqual([
      { type: 'text', text: 'before paste' },
      { type: 'text', text: 'pasted block', isPaste: true },
      { type: 'text', text: 'after paste' },
    ])
  })

  it('attaches contexts to the message when present and non-empty', () => {
    const msg = buildUserMessage(req({
      contexts: [{ appId: 'hello', appName: 'Hello', summary: '3 files', content: 'src/a.ts' }],
    }), 'local')
    expect(msg.contexts).toEqual([
      { appId: 'hello', appName: 'Hello', summary: '3 files', content: 'src/a.ts' },
    ])
  })

  it('attaches userSelections to the message when present and non-empty', () => {
    const msg = buildUserMessage(req({ userSelections: ['quote A', 'quote B'] }), 'local')
    expect(msg.userSelections).toEqual(['quote A', 'quote B'])
  })

  it('omits contexts / userSelections when empty arrays', () => {
    const msg = buildUserMessage(req({ contexts: [], userSelections: [] }), 'local')
    expect(msg.contexts).toBeUndefined()
    expect(msg.userSelections).toBeUndefined()
  })

  it('builds image / document blocks from request.images when userMessageContent is omitted', () => {
    const msg = buildUserMessage(req({
      images: [
        { name: 'pic.png', base64: 'data', mimeType: 'image/png' },
        { name: 'spec.pdf', base64: 'data', mimeType: 'application/pdf' },
      ],
    }), 'local')
    expect(msg.content).toEqual([
      { type: 'image', name: 'pic.png' },
      { type: 'document', name: 'spec.pdf' },
      { type: 'text', text: 'hello' },
    ])
    expect(msg.attachments).toEqual([
      { name: 'pic.png', base64: 'data', mimeType: 'image/png' },
      { name: 'spec.pdf', base64: 'data', mimeType: 'application/pdf' },
    ])
  })
})

describe('extractClaudeTitle', () => {
  function userMessage(text: string): ChatMessage {
    return {
      id: 'u1',
      role: 'user',
      status: 'complete',
      content: [{ type: 'text', text }],
      createdAt: '',
      providerId: 'local',
    }
  }

  it('returns plain user text', () => {
    expect(extractClaudeTitle([userMessage('write me a haiku')])).toBe('write me a haiku')
  })

  it('returns undefined when no user message', () => {
    expect(extractClaudeTitle([])).toBeUndefined()
  })

  it('truncates long text to 100 chars', () => {
    const long = 'x'.repeat(150)
    expect(extractClaudeTitle([userMessage(long)])).toBe('x'.repeat(100))
  })

  it('replaces miniapp tag with @AppName so title shows app name only', () => {
    const input = '<superone-miniapp><appname>Standalone Demo</appname><appid>standalone-demo</appid></superone-miniapp> increment please'
    expect(extractClaudeTitle([userMessage(input)])).toBe('@Standalone Demo increment please')
  })

  it('strips miniapp reminder block from title', () => {
    const input = 'do the thing\n\n<superone-miniapp-reminder>\ntools available\n</superone-miniapp-reminder>'
    expect(extractClaudeTitle([userMessage(input)])).toBe('do the thing')
  })

  it('handles miniapp tag plus reminder block together', () => {
    const input = '<superone-miniapp><appname>Notes</appname><appid>notes</appid></superone-miniapp> jot this down\n\n<superone-miniapp-reminder>\ntool info\n</superone-miniapp-reminder>'
    expect(extractClaudeTitle([userMessage(input)])).toBe('@Notes jot this down')
  })

  it('returns undefined for message that is only tags', () => {
    const input = '<superone-miniapp-reminder>only reminder</superone-miniapp-reminder>'
    expect(extractClaudeTitle([userMessage(input)])).toBeUndefined()
  })

  it('uses only the first user message', () => {
    const messages: ChatMessage[] = [
      userMessage('first one'),
      userMessage('second one'),
    ]
    expect(extractClaudeTitle(messages)).toBe('first one')
  })
})

describe('resuming a completed sub-agent via SendMessage (runtime)', () => {
  const ORIG = 'tu-orig-agent'
  const SENDMSG = 'tu-sendmessage'
  const TASK = 'task-1'

  function firstRun() {
    let rt = makeRuntime([agentMessage(ORIG)])
    rt = applyClaudeEventToRuntime(rt, { type: 'task_started', taskId: TASK, toolUseId: ORIG, description: 'analyze' } as AgentEvent)
    rt = applyClaudeEventToRuntime(rt, { type: 'content_delta', messageId: 'msg-1', delta: { type: 'text', text: 'first run', parentToolUseId: ORIG } } as AgentEvent)
    rt = applyClaudeEventToRuntime(rt, { type: 'task_notification', taskId: TASK, toolUseId: ORIG, taskStatus: 'completed', outputFile: '' } as AgentEvent)
    return rt
  }

  it('stores taskId on the task entry for later resume correlation', () => {
    const rt = firstRun()
    expect(rt.taskProgress[ORIG].taskId).toBe(TASK)
  })

  it('re-homes resumed sub-agent content under the Agent block, not the new message', () => {
    let rt = firstRun()
    rt = applyClaudeEventToRuntime(rt, { type: 'message_start', message: { id: 'msg-2', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' } } as AgentEvent)
    rt = applyClaudeEventToRuntime(rt, { type: 'content_delta', messageId: 'msg-2', delta: { type: 'text', text: 'main summary', parentToolUseId: null } } as AgentEvent)
    rt = applyClaudeEventToRuntime(rt, { type: 'content_delta', messageId: 'msg-2', delta: { type: 'text', text: 'RESUMED-OUTPUT', parentToolUseId: ORIG } } as AgentEvent)

    const msg1 = rt.messages.find((m) => m.id === 'msg-1')!
    const msg2 = rt.messages.find((m) => m.id === 'msg-2')!
    expect(msg1.content.some((b) => b.type === 'text' && b.text.includes('RESUMED-OUTPUT'))).toBe(true)
    expect(msg2.content.some((b) => b.type === 'text' && b.text.includes('RESUMED-OUTPUT'))).toBe(false)
  })

  it('routes the resume notification (SendMessage toolUseId) back to the original Agent block', () => {
    let rt = firstRun()
    rt = applyClaudeEventToRuntime(rt, { type: 'task_progress', taskId: TASK, toolUseId: ORIG, description: 'resumed work', usage: { totalTokens: 50, toolUses: 2, durationMs: 10 } } as AgentEvent)
    rt = applyClaudeEventToRuntime(rt, { type: 'task_notification', taskId: TASK, toolUseId: SENDMSG, taskStatus: 'completed', outputFile: '', usage: { totalTokens: 99, toolUses: 3, durationMs: 20 } } as AgentEvent)

    expect(rt.taskProgress[SENDMSG]).toBeUndefined()
    expect(rt.taskProgress[ORIG].totalTokens).toBe(99)
    const block = getAgentBlock(rt, ORIG)
    expect((block as { taskUsage?: { totalTokens: number } }).taskUsage?.totalTokens).toBe(99)
  })
})
