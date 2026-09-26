import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../remote-content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../remote-content')>()
  return { ...actual, stripMessagesForRemote: (messages: unknown) => messages }
})
import type { BashEditDiff, ChatMessage } from '@superone/shared/agent-types'
import { bashEditFileChanges, bashEditToolUses, summarizeBashEditDiff } from '@superone/shared/bash-edit-diff'
import { detailUpdates, projectProgressiveEvent, projectProgressiveMessage, setProgressiveSession, subscribeDetail, unsubscribeDetail } from './progressive-session'
const message = (): ChatMessage => ({ id: 'm', role: 'assistant', status: 'streaming', createdAt: '', providerId: 'claude', content: [
  { type: 'thinking', thinking: 'private reasoning', startedAt: 100 },
  { type: 'tool_use', toolName: 'Write', toolUseId: 't', input: JSON.stringify({ file_path: 'a.ts', content: 'large code' }), status: 'streaming' },
  { type: 'tool_result', toolUseId: 't', summary: 'large output' },
] })
afterEach(() => { setProgressiveSession('a'); setProgressiveSession('b') })
describe('progressive session projection', () => {
  it('sends Bash file names and line totals, then loads full hunks on expand', () => {
    const bashEditDiff: BashEditDiff = {
      files: [{ filePath: '/p/a.ts', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-before', '+after'] }] }],
      moreFiles: 1,
      changedFiles: ['/p/a.ts', '/p/logo.png'],
    }
    const source: ChatMessage = { ...message(), content: [
      { type: 'tool_use', toolName: 'Bash', toolUseId: 'bash', input: '{"command":"sed -i ..."}', status: 'complete' },
      { type: 'tool_result', toolUseId: 'bash', summary: 'done', bashEditDiff },
    ] }
    const projected = projectProgressiveMessage(source)
    const result = projected.content[1]
    const shellDiff = result.type === 'tool_result' ? result.bashEditDiff : undefined
    expect(shellDiff).toBeDefined()
    expect(JSON.stringify(projected)).not.toContain('before')
    expect(bashEditToolUses('bash', shellDiff!).map(row => row.filePath)).toEqual(['/p/a.ts', '/p/logo.png'])
    expect(summarizeBashEditDiff(shellDiff!)).toEqual({ files: 2, added: 1, removed: 1, approximate: true })
    expect(bashEditFileChanges(shellDiff!)).toEqual([
      { path: '/p/a.ts', added: 1, removed: 1 },
      { path: '/p/logo.png', added: 0, removed: 0 },
    ])
    expect(projectProgressiveEvent({ type: 'content_delta', sessionId: 's', messageId: 'm', delta: source.content[1] }, [source]))
      .toMatchObject({ delta: { toolUseId: 'bash', bashEditDiff: shellDiff } })
    setProgressiveSession('a', 's')
    const detail = subscribeDetail('a', 's', 'bash-detail', '["m","tool","bash"]', source)
    expect(JSON.parse(detail.text).bashEditDiff).toEqual(bashEditDiff)
  })
  it('retains shell state without hidden text, input, output, or mutation', () => {
    const original = message()
    const projected = projectProgressiveMessage(original)
    const wire = JSON.stringify(projected)
    expect(wire).not.toContain('private reasoning')
    expect(wire).not.toContain('large code')
    expect(wire).not.toContain('large output')
    expect(projected.content[0]).toMatchObject({ startedAt: 100, remoteDetail: '["m","thinking",0]' })
    expect(projected.content[1]).toMatchObject({ toolName: 'Write', toolLineDelta: { added: 1, removed: 0 } })
    expect(original.content[0]).toMatchObject({ thinking: 'private reasoning' })
  })
  it('sends no detail to a collapsed device and only additive text to the expanded device', () => {
    const source = message()
    setProgressiveSession('a', 's'); setProgressiveSession('b', 's')
    expect(subscribeDetail('a', 's', 'sub', '["m","thinking",0]', source)).toMatchObject({ text: 'private reasoning', revision: 0 })
    source.content[0] = { type: 'thinking', thinking: 'private reasoning more' }
    expect(detailUpdates('b', 's', [source])).toEqual([])
    expect(detailUpdates('a', 's', [source])).toEqual([{ type: 'remote_detail', sessionId: 's', subscriptionId: 'sub', revision: 1, offset: 17, text: ' more' }])
    expect(detailUpdates('a', 's', [source])).toEqual([])
    unsubscribeDetail('a', 's', 'sub')
    source.content[0] = { type: 'thinking', thinking: 'private reasoning more again' }
    expect(detailUpdates('a', 's', [source])).toEqual([])
  })
  it('replaces revised content and clears interests on reconnect/session switch', () => {
    const source = message()
    setProgressiveSession('a', 's')
    subscribeDetail('a', 's', 'sub', '["m","thinking",0]', source)
    source.content[0] = { type: 'thinking', thinking: 'replacement' }
    expect(detailUpdates('a', 's', [source])[0]).toMatchObject({ offset: 0, text: 'replacement' })
    setProgressiveSession('a', 'other')
    expect(detailUpdates('a', 's', [source])).toEqual([])
    expect(() => subscribeDetail('a', 's', 'sub', '["m","thinking",0]', source)).toThrow('expired')
  })
  it('strips Codex baseline, patches, and completion metadata without losing item IDs', () => {
    const source = { ...message(), metadata: { codex: { threadId: 'thread', usage: null, items: [
      { id: 'r', type: 'reasoning' as const, text: 'private reasoning' },
      { id: 'c', type: 'command_execution' as const, command: 'pwd', aggregatedOutput: 'large output', status: 'in_progress' as const },
    ] } } }
    expect(JSON.stringify(projectProgressiveMessage(source))).not.toMatch(/private reasoning|large output/)
    expect(projectProgressiveMessage(source).metadata?.codex?.items[0]).toMatchObject({ id: 'r', remoteDetail: '["m","reasoning","r"]' })
    expect(projectProgressiveEvent({ type: 'codex_item_patch', messageId: 'm', phase: 'updated', itemId: 'r', patch: { type: 'reasoning', textDelta: 'private reasoning' } }, [source])).toMatchObject({ patch: { textDelta: '' } })
    expect(JSON.stringify(projectProgressiveEvent({ type: 'message_complete', messageId: 'm', metadata: source.metadata }, [source]))).not.toMatch(/private reasoning|large output/)
  })
  it('keeps workflow agent rows on progressive task events while dropping transcript text', () => {
    const progress = projectProgressiveEvent({
      type: 'task_progress', taskId: 'wf', toolUseId: 'w', description: 'parity: catalog',
      usage: { totalTokens: 1, toolUses: 1, durationMs: 1 }, activityText: 'private activity',
      toolEntries: [{ toolName: 'Read', description: 'a.ts' }],
      workflowAgents: [{ label: 'cataloger', toolCount: 2, tokens: 1, state: 'running' }],
    }, [])
    expect(progress).toMatchObject({ workflowAgents: [{ label: 'cataloger' }], activityText: undefined, toolEntries: undefined })
    const done = projectProgressiveEvent({
      type: 'task_notification', taskId: 'wf', toolUseId: 'w', taskStatus: 'completed', outputFile: '/tmp/out.jsonl',
      resultText: 'long result', workflowAgents: [{ label: 'cataloger', toolCount: 2, tokens: 1, state: 'done' }],
    }, [])
    expect(done).toMatchObject({ workflowAgents: [{ label: 'cataloger' }], resultText: undefined, outputFile: '' })
  })
  it('projects a workflow shell with its declared meta and task lifecycle, and the run output on expand', () => {
    const script = 'export const meta = { name: "parity", description: "Gap the coverage", phases: [{ title: "Source", detail: "clone" }] }\n' + 'x'.repeat(2000)
    const source: ChatMessage = { ...message(), content: [
      { type: 'tool_use', toolName: 'Workflow', toolUseId: 'w', input: JSON.stringify({ script }), status: 'complete',
        taskStatus: 'completed', taskSummary: 'done', taskResultText: 'Plan written', taskUsage: { totalTokens: 9, toolUses: 2, durationMs: 200 },
        workflowAgents: [{ label: 'cataloger', toolCount: 2, tokens: 9, state: 'done' }] },
      { type: 'tool_result', toolUseId: 'w', summary: '{"runId":"wf_1","transcriptDir":"/tmp/wf_1"}' },
    ] }
    const shell = projectProgressiveMessage(source).content[0]
    expect(JSON.stringify(shell)).not.toContain('xxxx')
    expect(shell).toMatchObject({
      input: '', workflowName: 'parity', workflowDescription: 'Gap the coverage',
      workflowPhases: [{ title: 'Source', detail: 'clone' }], taskStatus: 'completed', taskSummary: 'done',
      taskUsage: { totalTokens: 9 }, workflowAgents: [{ label: 'cataloger' }],
    })
    expect(shell).not.toHaveProperty('taskResultText')
    setProgressiveSession('a', 's')
    expect(JSON.parse(subscribeDetail('a', 's', 'wf', '["m","tool","w"]', source).text)).toMatchObject({ taskResultText: 'Plan written' })
  })
  it('fetches original tool input and full result only on expansion', () => {
    setProgressiveSession('a', 's')
    const detail = subscribeDetail('a', 's', 'tool', '["m","tool","t"]', message())
    expect(JSON.parse(detail.text)).toMatchObject({ result: 'large output', input: JSON.stringify({ file_path: 'a.ts', content: 'large code' }) })
  })
  it('projects a live Edit delta with line counts and no replaced bodies', () => {
    const projected = projectProgressiveEvent({
      type: 'content_delta',
      sessionId: 's',
      messageId: 'm',
      delta: {
        type: 'tool_use',
        toolName: 'Edit',
        toolUseId: 't',
        input: JSON.stringify({ file_path: 'a.ts', old_string: 'const enabled = false', new_string: 'const enabled = true' }),
        status: 'streaming',
      },
    }, [])
    expect(projected).toMatchObject({
      remoteView: 'summary',
      delta: { toolName: 'Edit', toolLineDelta: { added: 1, removed: 1 }, remoteDetail: '["m","tool","t"]' },
    })
    expect(JSON.stringify(projected)).not.toContain('old_string')
    expect(JSON.stringify(projected)).not.toContain('const enabled')
  })
  /**
   * `/code-review` runs as a forked Skill: every Bash and ReportFindings block it
   * emits is parented to the Skill tool_use. The desktop renders them inline, so
   * the phone must receive them live — only subagent cards hide their children
   * behind the card's detail.
   */
  it('streams a forked Skill\'s child blocks but not a subagent\'s', () => {
    const findings = JSON.stringify({ findings: [{ file: 'a.ts', line: 3, summary: 'x'.repeat(1500) }] })
    const parent = (toolName: string, toolUseId: string): ChatMessage => ({ ...message(), content: [
      { type: 'tool_use', toolName, toolUseId, input: '{}', status: 'streaming' },
    ] })
    const child = (parentToolUseId: string, toolName = 'Bash', input = '{"command":"git diff"}') => projectProgressiveEvent({
      type: 'content_delta', sessionId: 's', messageId: 'm',
      delta: { type: 'tool_use', toolName, toolUseId: 'c', input, status: 'streaming', parentToolUseId },
    }, [parent(parentToolUseId === 'skill' ? 'Skill' : 'Task', parentToolUseId)])
    expect(child('skill')).toMatchObject({ delta: { toolName: 'Bash', parentToolUseId: 'skill', remoteDetail: '["m","tool","c"]' } })
    expect(child('task')).toBeNull()
    expect(child('skill', 'ReportFindings', findings)).toMatchObject({ delta: { toolName: 'ReportFindings', input: findings } })
    const persisted = projectProgressiveMessage({ ...message(), content: [
      ...parent('Skill', 'skill').content,
      { type: 'tool_use', toolName: 'ReportFindings', toolUseId: 'r', input: findings, status: 'complete', parentToolUseId: 'skill' },
      ...parent('Task', 'task').content,
      { type: 'tool_use', toolName: 'Read', toolUseId: 'n', input: '{"file_path":"a.ts"}', status: 'complete', parentToolUseId: 'task' },
    ] })
    expect(persisted.content.map(block => block.type === 'tool_use' ? block.toolUseId : block.type)).toEqual(['skill', 'r', 'task'])
    expect(persisted.content[1]).toMatchObject({ input: findings })
  })
  it('carries a subagent\'s file edits on its shell and refreshes the shell when a child edit lands', () => {
    const editInput = JSON.stringify({ file_path: '/p/a.ts', old_string: 'a', new_string: 'b\nc' })
    const withEdit: ChatMessage = { ...message(), content: [
      { type: 'tool_use', toolName: 'Agent', toolUseId: 'task', input: '{"description":"Fix it","name":"fixer","prompt":"go"}', status: 'streaming' },
      { type: 'tool_use', toolName: 'Read', toolUseId: 'r', input: '{"file_path":"a.ts"}', status: 'complete', parentToolUseId: 'task' },
      { type: 'tool_use', toolName: 'Edit', toolUseId: 'e', input: editInput, status: 'streaming', parentToolUseId: 'task' },
    ] }
    // Snapshot: children dropped, the card knows what they edited.
    const shell = projectProgressiveMessage(withEdit).content
    expect(shell).toHaveLength(1)
    expect(shell[0]).toMatchObject({ toolUseId: 'task', taskFileChanges: [{ path: '/p/a.ts', added: 2, removed: 1 }] })
    // Live: a Read under the card is dropped; an Edit resends the card's shell in its place.
    const child = (toolUseId: string, toolName: string, input: string) => projectProgressiveEvent({
      type: 'content_delta', sessionId: 's', messageId: 'm',
      delta: { type: 'tool_use', toolName, toolUseId, input, status: 'streaming', parentToolUseId: 'task' },
    }, [withEdit])
    expect(child('r', 'Read', '{"file_path":"a.ts"}')).toBeNull()
    expect(child('e', 'Edit', editInput)).toMatchObject({
      type: 'content_delta', messageId: 'm',
      delta: { toolUseId: 'task', toolName: 'Agent', remoteDetail: '["m","tool","task"]', taskFileChanges: [{ path: '/p/a.ts', added: 2, removed: 1 }] },
    })
    // The edit's denial clears the row it added.
    const denied: ChatMessage = { ...withEdit, content: [...withEdit.content, { type: 'tool_result', toolUseId: 'e', summary: '[denied] no', parentToolUseId: 'task' }] }
    expect(projectProgressiveEvent({
      type: 'content_delta', sessionId: 's', messageId: 'm',
      delta: { type: 'tool_result', toolUseId: 'e', summary: '[denied] no', parentToolUseId: 'task' },
    }, [denied])).toMatchObject({ delta: { toolUseId: 'task', taskFileChanges: [] } })
  })
  it('keeps a browser screenshot path in the summary so the phone can load the image', () => {
    const source: ChatMessage = {
      id: 'm',
      role: 'assistant',
      status: 'complete',
      createdAt: '',
      providerId: 'claude',
      content: [
        {
          type: 'tool_use',
          toolName: 'mcp__superone__browser_snapshot',
          toolUseId: 'shot',
          input: JSON.stringify({ include: ['screenshot'], description: 'Google home' }),
          status: 'complete',
        },
        {
          type: 'tool_result',
          toolUseId: 'shot',
          summary: JSON.stringify({ path: '/tmp/google.png', width: 960, height: 1636, outline: 'x'.repeat(400) }),
        },
      ],
    }
    const projected = projectProgressiveMessage(source)
    const result = projected.content.find((block) => block.type === 'tool_result')
    expect(result).toMatchObject({ type: 'tool_result', toolUseId: 'shot' })
    expect(JSON.parse((result as { summary: string }).summary)).toEqual({
      path: '/tmp/google.png',
      width: 960,
      height: 1636,
    })
    expect(JSON.stringify(projected)).not.toContain('outline')
  })
  it('unwraps an MCP envelope before keeping the screenshot path', () => {
    const inner = JSON.stringify({ path: '/tmp/google.png', width: 10, height: 10 })
    const source: ChatMessage = {
      id: 'm',
      role: 'assistant',
      status: 'complete',
      createdAt: '',
      providerId: 'claude',
      content: [
        {
          type: 'tool_use',
          toolName: 'mcp__superone__browser_snapshot',
          toolUseId: 'shot',
          input: JSON.stringify({ include: ['screenshot'] }),
          status: 'complete',
        },
        {
          type: 'tool_result',
          toolUseId: 'shot',
          summary: JSON.stringify({ content: [{ type: 'text', text: inner }], isError: false }),
        },
      ],
    }
    const result = projectProgressiveMessage(source).content.find((block) => block.type === 'tool_result') as { summary: string }
    expect(JSON.parse(result.summary)).toMatchObject({ path: '/tmp/google.png' })
  })
})

it('keeps a large hidden payload out of the initial view', () => {
  const source = message()
  source.content[0] = { type: 'thinking', thinking: 'R'.repeat(300_000) }
  source.content[1] = { type: 'tool_use', toolName: 'Write', toolUseId: 't', input: JSON.stringify({ file_path: 'a.ts', content: 'C'.repeat(500_000) }) }
  source.content[2] = { type: 'tool_result', toolUseId: 't', summary: 'O'.repeat(500_000) }
  const before = Buffer.byteLength(JSON.stringify(source))
  const after = Buffer.byteLength(JSON.stringify(projectProgressiveMessage(source)))
  expect(before).toBeGreaterThan(1_300_000)
  expect(after).toBeLessThan(1_000)
  console.info('[ProgressivePayload]', JSON.stringify({ rawBytes: before, shellBytes: after }))
})

it('chunks large detail changes into bounded, reconstructable packets', () => {
  const source = message()
  setProgressiveSession('a', 's')
  const initial = subscribeDetail('a', 's', 'sub', '["m","thinking",0]', source)
  const expected = 'replacement '.repeat(20_000)
  source.content[0] = { type: 'thinking', thinking: expected }
  let text = initial.text
  const updates = detailUpdates('a', 's', [source])
  expect(updates.length).toBeGreaterThan(1)
  for (const update of updates) {
    if (update.type !== 'remote_detail') throw new Error('wrong update')
    expect(update.text.length).toBeLessThanOrEqual(64_000)
    text = text.slice(0, update.offset) + update.text
  }
  expect(text).toBe(expected)
})
