import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deriveAntigravityBrainRootFromLogPath,
  extractAntigravityPrompt,
  listWorkflowAgents,
  readWorkflowScript,
  resolveAntigravityWorkflowAgentTranscripts,
  summarizeAntigravityAgentTranscript,
} from './workflow-transcripts'

function jsonl(lines: object[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
}

describe('listWorkflowAgents', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wf-transcripts-'))
    await writeFile(join(dir, 'agent-aaa111.jsonl'), jsonl([
      { type: 'user', message: { role: 'user', content: '你负责颜色 红色，返回它的十六进制。\n（第二行被忽略）' } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch' }], usage: { input_tokens: 500, output_tokens: 30 } } },
      { type: 'assistant', message: { content: [{ type: 'text', text: '红色是 #FF0000' }], usage: { input_tokens: 1000, output_tokens: 20 } } },
    ]))
    await writeFile(join(dir, 'agent-aaa111.meta.json'), JSON.stringify({ agentType: 'workflow-subagent' }))
    const cachedUsage = { input_tokens: 2, cache_creation_input_tokens: 4000, cache_read_input_tokens: 36000, output_tokens: 16 }
    await writeFile(join(dir, 'agent-ddd444.jsonl'), jsonl([
      { type: 'user', message: { role: 'user', content: 'cached' } },
      { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'thinking' }], usage: { ...cachedUsage, cache_read_input_tokens: 6000 } } },
      { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'tool_use', name: 'Read' }], usage: { ...cachedUsage, cache_read_input_tokens: 6000 } } },
      { type: 'assistant', message: { id: 'msg_2', content: [{ type: 'text', text: 'done' }], usage: cachedUsage } },
    ]))
    await writeFile(join(dir, 'agent-bbb222.jsonl'), jsonl([
      { type: 'user', message: { role: 'user', content: '打个招呼' } },
    ]))
    await writeFile(join(dir, 'agent-ccc333.jsonl'), jsonl([
      { type: 'user', message: { role: 'user', content: '\nRead the file and identify the key functions.\nFocus on pure functions.' } },
    ]))
    await writeFile(join(dir, 'journal.jsonl'), jsonl([
      { type: 'launched' },
      { type: 'started', key: 'v2:abc', agentId: 'aaa111', label: 'color:red', phase: 'Colors' },
      { type: 'started', key: 'v2:def', agentId: 'ccc333', label: 'scan', phase: 'Scan' },
      { type: 'started', key: 'v2:ghi', agentId: 'ddd444' },
      { type: 'result', key: 'v2:abc', agentId: 'aaa111', result: { hex: '#FF0000' } },
      { type: 'failed', key: 'v2:def', agentId: 'ccc333' },
    ]))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('derives label from the first non-empty prompt line when the journal has none', async () => {
    const agents = await listWorkflowAgents(dir)
    const bbb = agents.find((a) => a.agentId === 'bbb222')!
    expect(bbb.label).toBe('打个招呼')
  })

  it('takes label, phase, and lifecycle state from journal.jsonl', async () => {
    const byId = new Map((await listWorkflowAgents(dir)).map((a) => [a.agentId, a]))
    expect(byId.get('aaa111')).toMatchObject({ label: 'color:red', phase: 'Colors', state: 'completed' })
    expect(byId.get('ccc333')).toMatchObject({ label: 'scan', phase: 'Scan', state: 'failed' })
    expect(byId.get('ddd444')).toMatchObject({ label: 'cached', state: 'running' })
    expect(byId.get('ddd444')?.phase).toBeUndefined()
    expect(byId.get('bbb222')?.state).toBeUndefined()
  })

  it('lists agent transcripts with label from prompt, tool count, and result text', async () => {
    const agents = await listWorkflowAgents(dir)
    expect(agents.map((a) => a.agentId)).toEqual(['aaa111', 'bbb222', 'ccc333', 'ddd444'])
    const red = agents[0]
    expect(red.label).toBe('color:red')
    expect(red.prompt).toBe('你负责颜色 红色，返回它的十六进制。\n（第二行被忽略）')
    expect(red.toolCount).toBe(1)
    expect(red.tokens).toBe(1050)
    expect(red.resultText).toBe('红色是 #FF0000')
    expect(red.jsonlPath).toBe(join(dir, 'agent-aaa111.jsonl'))
  })

  it('ignores non-agent files and returns id-only fallback for promptless transcripts', async () => {
    const agents = await listWorkflowAgents(dir)
    expect(agents).toHaveLength(4)
    expect(agents[1].toolCount).toBe(0)
  })

  it('counts cached prompt tokens and each response once across its split records', async () => {
    const agents = await listWorkflowAgents(dir)
    const cached = agents.find((a) => a.agentId === 'ddd444')
    expect(cached?.toolCount).toBe(1)
    expect(cached?.tokens).toBe(40_002 + 16 + 16)
  })

  it('attaches the structured result from journal.jsonl by agentId', async () => {
    const agents = await listWorkflowAgents(dir)
    expect(agents[0].result).toEqual({ hex: '#FF0000' })
    expect(agents[1].result).toBeUndefined()
  })

  it('returns empty array for a missing directory', async () => {
    expect(await listWorkflowAgents(join(dir, 'does-not-exist'))).toEqual([])
  })
})

describe('listWorkflowAgents — Grok layout', () => {
  let sessionsRoot: string
  let sessionDir: string
  let workflowDir: string
  let childSessionDir: string

  beforeAll(async () => {
    // Mirror real layout: ~/.grok/sessions/<cwd-enc>/<parent>/workflows/wf_x
    //                         ~/.grok/sessions/<cwd-enc>/<child>/chat_history.jsonl
    sessionsRoot = await mkdtemp(join(tmpdir(), 'wf-grok-sessions-'))
    sessionDir = join(sessionsRoot, 'parent-session')
    childSessionDir = join(sessionsRoot, 'child-agent-1')
    workflowDir = join(sessionDir, 'workflows', 'wf_demo')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(workflowDir, { recursive: true })
    await mkdir(join(sessionDir, 'subagents', 'agent-1'), { recursive: true })
    await mkdir(childSessionDir, { recursive: true })
    await writeFile(join(workflowDir, 'state.json'), JSON.stringify({
      version: 4,
      state: {
        run_id: 'wf_demo',
        agents: [
          { agent_id: 'agent-1', label: 'inventory', tokens_used: 1200, state: 'done' },
          { agent_id: 'agent-2', label: 'verify', tokens_used: 400, state: 'done' },
        ],
      },
    }))
    await writeFile(join(sessionDir, 'subagents', 'agent-1', 'meta.json'), JSON.stringify({
      subagent_id: 'agent-1',
      child_session_id: 'child-agent-1',
      prompt: 'Inventory session ops',
      description: 'inventory',
      tool_calls: 2,
    }))
    await writeFile(join(sessionDir, 'subagents', 'agent-1', 'output.json'), JSON.stringify({
      schema_version: 1,
      output: '## Findings\n- local only',
    }))
    await writeFile(join(childSessionDir, 'chat_history.jsonl'), [
      JSON.stringify({
        type: 'assistant',
        content: 'Scanning…',
        tool_calls: [
          { id: 'c1', name: 'grep', arguments: JSON.stringify({ pattern: 'session', path: '/proj' }) },
          { id: 'c2', name: 'read_file', arguments: JSON.stringify({ target_file: '/proj/a.ts' }) },
        ],
      }),
      JSON.stringify({ type: 'tool_result', tool_call_id: 'c1', content: 'hits' }),
      JSON.stringify({ type: 'tool_result', tool_call_id: 'c2', content: 'file body' }),
      JSON.stringify({ type: 'assistant', content: 'Done scanning.' }),
    ].join('\n') + '\n')
  })

  afterAll(async () => {
    await rm(sessionsRoot, { recursive: true, force: true })
  })

  it('lists agents and points jsonlPath at child chat_history for tool activity', async () => {
    const agents = await listWorkflowAgents(workflowDir)
    expect(agents).toHaveLength(2)
    expect(agents[0]).toMatchObject({
      agentId: 'agent-1',
      label: 'inventory',
      tokens: 1200,
      prompt: 'Inventory session ops',
      resultText: '## Findings\n- local only',
      toolCount: 2,
    })
    expect(agents[0].jsonlPath).toBe(join(childSessionDir, 'chat_history.jsonl'))
    expect(agents[1]).toMatchObject({ agentId: 'agent-2', label: 'verify', tokens: 400 })
  })
})

describe('readWorkflowScript', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wf-scripts-'))
    await writeFile(join(dir, 'demo.py'), 'phase("Demo")\nlog("ok")\n')
    await writeFile(join(dir, 'demo.js'), 'phase("Demo")\n')
    await writeFile(join(dir, 'demo.rhai'), 'phase("Demo");\n')
    await writeFile(join(dir, 'notes.txt'), 'ignored')
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads .py, .js, and .rhai workflow scripts and rejects other extensions', async () => {
    expect(await readWorkflowScript(join(dir, 'demo.py'))).toBe('phase("Demo")\nlog("ok")\n')
    expect(await readWorkflowScript(join(dir, 'demo.js'))).toBe('phase("Demo")\n')
    expect(await readWorkflowScript(join(dir, 'demo.rhai'))).toBe('phase("Demo");\n')
    expect(await readWorkflowScript(join(dir, 'notes.txt'))).toBeNull()
  })
})

describe('Antigravity workflow child agent transcript.jsonl support', () => {
  let brainRoot: string
  const parentId = 'parent-conv-1'
  const childId = '9f0dcf74-84b2-4228-a843-64512b3139b9'
  const sampleTranscript = [
    JSON.stringify({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-11-26T08:14:28Z',
      content: '<USER_REQUEST>\nReply with only the uppercase version of: Hello\n</USER_REQUEST>\nExtra metadata',
    }),
    JSON.stringify({
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-26T08:14:30Z',
      model: 'gemini-3.5-flash-lite',
      input_tokens: 16339,
      cache_read_tokens: 0,
      output_tokens: 31,
      thinking: 'Need to return HELLO.',
      tool_calls: [{ name: 'session_rename', args: { tags: '["demo"]', title: '"Demo"' } }],
    }),
    JSON.stringify({
      step_index: 2,
      source: 'MODEL',
      type: 'GENERIC',
      status: 'INVALID',
      error: 'unknown tool: "session_rename" — check spelling',
      created_at: '2026-11-26T08:14:32Z',
      content: 'Created At: 2026-11-26T08:14:32Z\nError invalid tool call: unknown tool',
    }),
    JSON.stringify({
      step_index: 3,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-26T08:14:36Z',
      model: 'gemini-3.5-flash-lite',
      input_tokens: 2179,
      cache_read_tokens: 14223,
      output_tokens: 46,
      tool_calls: [{ name: 'finish', args: { result: '"HELLO"' } }],
    }),
    JSON.stringify({
      step_index: 4,
      source: 'MODEL',
      type: 'GENERIC',
      status: 'DONE',
      created_at: '2026-11-26T08:14:37Z',
      content: 'Finished.',
    }),
  ].join('\n') + '\n'

  beforeAll(async () => {
    const { mkdir } = await import('node:fs/promises')
    brainRoot = await mkdtemp(join(tmpdir(), 'wf-agy-brain-'))
    await mkdir(join(brainRoot, parentId, '.system_generated', 'tasks'), { recursive: true })
    await mkdir(join(brainRoot, childId, '.system_generated', 'logs'), { recursive: true })
    await writeFile(join(brainRoot, childId, '.system_generated', 'logs', 'transcript.jsonl'), sampleTranscript)
  })

  afterAll(async () => {
    await rm(brainRoot, { recursive: true, force: true })
  })

  it('derives brainRoot from task-N.log path and extracts USER_REQUEST prompt', () => {
    const logPath = join(brainRoot, parentId, '.system_generated', 'tasks', 'task-6.log')
    expect(deriveAntigravityBrainRootFromLogPath(logPath)).toBe(brainRoot)
    expect(deriveAntigravityBrainRootFromLogPath('/tmp/task-6.log')).toBeUndefined()
    expect(extractAntigravityPrompt('<USER_REQUEST>\nHello\n</USER_REQUEST>\nTrailing')).toBe('Hello')
    expect(extractAntigravityPrompt('Plain prompt')).toBe('Plain prompt')
  })

  it('summarizes prompt, toolCount, tokens, and finish resultText from Antigravity transcript.jsonl', () => {
    expect(summarizeAntigravityAgentTranscript(sampleTranscript)).toEqual({
      prompt: 'Reply with only the uppercase version of: Hello',
      toolCount: 2,
      tokens: 32818,
      resultText: 'HELLO',
    })
  })

  it('resolves existing child transcripts from logPath or fallback brainRoots and omits missing/unsafe ids', async () => {
    const logPath = join(brainRoot, parentId, '.system_generated', 'tasks', 'task-6.log')
    const resolved = await resolveAntigravityWorkflowAgentTranscripts({
      agentIds: [childId, 'missing-agent', '../escape'],
      logPath,
      customBrainRoots: [],
    })
    expect(Object.keys(resolved)).toEqual([childId])
    expect(resolved[childId]).toEqual({
      agentId: childId,
      jsonlPath: join(brainRoot, childId, '.system_generated', 'logs', 'transcript.jsonl'),
      prompt: 'Reply with only the uppercase version of: Hello',
      toolCount: 2,
      tokens: 32818,
      resultText: 'HELLO',
      transcriptAvailable: true,
    })

    const viaFallbackRoot = await resolveAntigravityWorkflowAgentTranscripts({
      agentIds: [childId],
      customBrainRoots: [brainRoot],
    })
    expect(viaFallbackRoot[childId]?.jsonlPath).toBe(
      join(brainRoot, childId, '.system_generated', 'logs', 'transcript.jsonl'),
    )
  })
})
