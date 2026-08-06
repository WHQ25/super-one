import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listWorkflowAgents } from './workflow-transcripts'

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
    await writeFile(join(dir, 'agent-bbb222.jsonl'), jsonl([
      { type: 'user', message: { role: 'user', content: '打个招呼' } },
    ]))
    await writeFile(join(dir, 'agent-ccc333.jsonl'), jsonl([
      { type: 'user', message: { role: 'user', content: '\nRead the file and identify the key functions.\nFocus on pure functions.' } },
    ]))
    await writeFile(join(dir, 'journal.jsonl'), jsonl([
      { type: 'started', key: 'v2:abc', agentId: 'aaa111' },
      { type: 'result', key: 'v2:abc', agentId: 'aaa111', result: { hex: '#FF0000' } },
    ]))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('derives label from the first non-empty prompt line when the prompt starts with a newline', async () => {
    const agents = await listWorkflowAgents(dir)
    const ccc = agents.find((a) => a.agentId === 'ccc333')!
    expect(ccc.label).toBe('Read the file and identify the key functions.')
  })

  it('lists agent transcripts with label from prompt, tool count, and result text', async () => {
    const agents = await listWorkflowAgents(dir)
    expect(agents.map((a) => a.agentId)).toEqual(['aaa111', 'bbb222', 'ccc333'])
    const red = agents[0]
    expect(red.label).toBe('你负责颜色 红色，返回它的十六进制。')
    expect(red.prompt).toBe('你负责颜色 红色，返回它的十六进制。\n（第二行被忽略）')
    expect(red.toolCount).toBe(1)
    expect(red.tokens).toBe(1050)
    expect(red.resultText).toBe('红色是 #FF0000')
    expect(red.jsonlPath).toBe(join(dir, 'agent-aaa111.jsonl'))
  })

  it('ignores non-agent files and returns id-only fallback for promptless transcripts', async () => {
    const agents = await listWorkflowAgents(dir)
    expect(agents).toHaveLength(3)
    expect(agents[1].toolCount).toBe(0)
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
