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
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('lists agent transcripts with label from prompt, tool count, and result text', async () => {
    const agents = await listWorkflowAgents(dir)
    expect(agents.map((a) => a.agentId)).toEqual(['aaa111', 'bbb222'])
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
    expect(agents).toHaveLength(2)
    expect(agents[1].toolCount).toBe(0)
  })

  it('returns empty array for a missing directory', async () => {
    expect(await listWorkflowAgents(join(dir, 'does-not-exist'))).toEqual([])
  })
})
