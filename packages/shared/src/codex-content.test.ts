import { describe, expect, it } from 'vitest'
import type { CodexCollabToolCallItem, CodexThreadItem, ContentBlock } from './agent-types'
import { applyContentDelta } from './content-delta'
import {
  CODEX_AGENT_WAIT_TOOL,
  CODEX_FILE_CHANGE_FAILED,
  CODEX_IMAGE_GENERATION_TOOL,
  CODEX_TODO_TOOL,
  codexItemToBlocks,
  codexItemsToContent,
  createCodexContentStream,
} from './codex-content'

function streamAll(snapshots: CodexThreadItem[]): ContentBlock[] {
  const stream = createCodexContentStream()
  let content: ContentBlock[] = []
  for (const item of snapshots) {
    for (const { delta, replace } of stream.update(item)) content = applyContentDelta(content, delta, () => 0, { replace })
  }
  return content
}

describe('codexItemToBlocks', () => {
  it('keeps an async question on its text block for the decision queue', () => {
    const questions = [{ title: 'Which branch?', options: ['main', 'dev'] }]
    expect(codexItemToBlocks({ id: 'q', type: 'agent_message', text: 'Pick one', delivery: 'async', questions })).toEqual([
      { type: 'text', id: 'q', text: 'Pick one', parentToolUseId: null, codexAsyncQuestions: questions },
    ])
  })

  it('keeps a non-zero exit an outcome and a failed exit-less command an error', () => {
    const exited = codexItemToBlocks({ id: 'c', type: 'command_execution', command: 'false', aggregatedOutput: '', exitCode: 1, status: 'failed' })
    expect(exited[1]).toEqual({ type: 'tool_result', toolUseId: 'c', summary: '', parentToolUseId: null, exitCode: 1 })
    const broken = codexItemToBlocks({ id: 'c', type: 'command_execution', command: 'x', aggregatedOutput: 'spawn failed', status: 'failed' })
    expect(broken[1]).toMatchObject({ isError: true, summary: 'spawn failed' })
  })

  it('streams a running command as live output and keeps its parsed actions', () => {
    const [call] = codexItemToBlocks({ id: 'c', type: 'command_execution', command: 'cat a && ls', cwd: '/w', aggregatedOutput: 'a', status: 'in_progress',
      commandActions: [{ type: 'read', path: '/w/a' }, { type: 'listFiles', path: '.' }] })
    expect(call).toMatchObject({ toolName: 'Bash', status: 'streaming', liveOutput: 'a' })
    expect(JSON.parse((call as { input: string }).input)).toEqual({ command: 'cat a && ls', cwd: '/w', commandActions: [{ type: 'read', path: '/w/a' }, { type: 'listFiles', path: '.' }] })
  })

  it('draws one row per file change and an error row for a failed patch with no changes', () => {
    const blocks = codexItemToBlocks({ id: 'p', type: 'file_change', status: 'completed', changes: [
      { path: 'a.ts', kind: 'update', diff: '@@' }, { path: 'b.ts', kind: 'add' },
    ] })
    expect(blocks.map(block => 'toolUseId' in block ? block.toolUseId : null)).toEqual(['p:0', 'p:1'])
    expect(codexItemToBlocks({ id: 'p', type: 'file_change', status: 'failed', changes: [] })).toEqual([
      expect.objectContaining({ toolName: 'FileChange', toolUseId: 'p:0', input: '{}' }),
      { type: 'tool_result', toolUseId: 'p:0', summary: CODEX_FILE_CHANGE_FAILED, parentToolUseId: null, isError: true },
    ])
  })

  it('keeps MCP auth, JSON fallback results and the tool error flag', () => {
    const blocks = codexItemToBlocks({ id: 'm', type: 'mcp_tool_call', server: 'drive', tool: 'list', arguments: { q: 1 }, status: 'completed',
      authRequired: true, result: { content: [], structuredContent: { rows: 2 }, isError: true } })
    expect(blocks[0]).toMatchObject({ toolName: 'mcp__drive__list', input: '{"q":1}', authRequired: true })
    expect(blocks[1]).toMatchObject({ isError: true, summary: JSON.stringify({ content: [], structuredContent: { rows: 2 }, isError: true }) })
  })

  it('carries a todo list on a hidden completed todo call', () => {
    const [todo] = codexItemToBlocks({ id: 'todo_t', type: 'todo_list', items: [{ text: 'Read', completed: true }, { text: 'Edit', completed: false }] })
    expect(todo).toMatchObject({ toolName: CODEX_TODO_TOOL, toolUseId: 'todo_t', status: 'complete' })
    expect(JSON.parse((todo as { input: string }).input).todos).toEqual([
      { content: 'Read', status: 'completed', activeForm: 'Read' },
      { content: 'Edit', status: 'pending', activeForm: 'Edit' },
    ])
  })

  it('puts an image generation status in the input so a seal cannot freeze it', () => {
    const [image] = codexItemToBlocks({ id: 'img', type: 'image_generation', status: 'in_progress', revisedPrompt: 'a fox', warnings: ['slow'] })
    expect(image).toMatchObject({ toolName: CODEX_IMAGE_GENERATION_TOOL, status: 'complete' })
    expect(JSON.parse((image as { input: string }).input)).toEqual({ status: 'in_progress', revisedPrompt: 'a fox', warnings: ['slow'] })
  })

  it('turns errors, review markers and compaction into identified notices', () => {
    expect(codexItemsToContent([
      { id: 'e', type: 'error', message: 'Strict review required' },
      { id: 'r', type: 'review', phase: 'entered', text: 'uncommitted changes' },
      { id: 'k', type: 'compaction' },
    ])).toEqual([
      { type: 'notice', id: 'e', level: 'error', text: 'Strict review required', parentToolUseId: null },
      { type: 'review', id: 'r', phase: 'entered', text: 'uncommitted changes', parentToolUseId: null },
      { type: 'notice', id: 'k', level: 'info', kind: 'compaction', text: '', parentToolUseId: null },
    ])
  })

  describe('collab calls', () => {
    const spawn = (status: CodexCollabToolCallItem['agentsStates'][string]['status'], tool: CodexCollabToolCallItem['tool'] = 'spawnAgent'): CodexCollabToolCallItem => ({
      id: tool === 'spawnAgent' ? 's' : 'f', type: 'collab_tool_call', tool, status: 'completed', receiverThreadIds: ['child'], prompt: 'count lines',
      agentsStates: { child: { status, nickname: 'Ada', role: 'explorer', message: 'Done: 4 lines', tokens: { input: 10, output: 5 } } },
      childItems: { child: [{ id: 'cmd', type: 'command_execution', command: 'wc -l', aggregatedOutput: '4', exitCode: 0, status: 'completed' }] },
    })

    it('makes an agent card for a spawn and its follow-up, each owning its own children', () => {
      const [card, ...rest] = codexItemToBlocks(spawn('completed'))
      expect(card).toMatchObject({ toolName: 'Agent', toolUseId: 's', status: 'complete', taskThreadId: 'child', taskStatus: 'completed', taskDescription: 'Ada', taskResultText: 'Done: 4 lines' })
      const outcome = rest.pop()
      expect(rest.every(block => 'parentToolUseId' in block && block.parentToolUseId === 's')).toBe(true)
      expect(outcome).toEqual({ type: 'tool_result', toolUseId: 's', summary: 'Done: 4 lines', parentToolUseId: null })
      const [followUp, child] = codexItemToBlocks(spawn('running', 'sendInput'))
      expect(followUp).toMatchObject({ toolName: 'Agent', toolUseId: 'f', status: 'streaming' })
      expect(followUp).not.toHaveProperty('taskStatus')
      expect(JSON.parse((followUp as { input: string }).input)).toMatchObject({ followUp: true })
      expect(child).toMatchObject({ parentToolUseId: 'f' })
    })

    it('maps agent outcomes onto the shared terminal lifecycle', () => {
      expect(codexItemToBlocks(spawn('errored'))[0]).toMatchObject({ taskStatus: 'failed', taskSummary: 'errored' })
      expect(codexItemToBlocks(spawn('errored')).at(-1)).toMatchObject({ type: 'tool_result', isError: true })
      expect(codexItemToBlocks(spawn('notFound'))[0]).toMatchObject({ taskStatus: 'stopped' })
      expect(codexItemToBlocks(spawn('pendingInit'))[0]).toMatchObject({ status: 'streaming' })
    })

    it('waits visibly, then hands the finished wait a result, and drops bookkeeping calls', () => {
      const waiting: CodexCollabToolCallItem = { id: 'w', type: 'collab_tool_call', tool: 'wait', status: 'in_progress', receiverThreadIds: ['child'], agentsStates: {} }
      expect(codexItemToBlocks(waiting)).toEqual([expect.objectContaining({ toolName: CODEX_AGENT_WAIT_TOOL, status: 'streaming' })])
      expect(codexItemToBlocks({ ...waiting, status: 'completed' })[1]).toMatchObject({ type: 'tool_result', toolUseId: 'w' })
      expect(codexItemToBlocks({ ...waiting, tool: 'closeAgent', status: 'completed' })).toEqual([])
      expect(codexItemToBlocks({ ...spawn('running'), receiverThreadIds: [] })).toEqual([])
    })
  })
})

describe('createCodexContentStream', () => {
  it('replaces a block whose text was rewritten rather than extended', () => {
    const stream = createCodexContentStream()
    stream.update({ id: 'a', type: 'agent_message', text: 'Draft answer' })
    expect(stream.update({ id: 'a', type: 'agent_message', text: 'Final answer' })).toEqual([
      { delta: { type: 'text', id: 'a', text: 'Final answer', parentToolUseId: null }, replace: true },
    ])
  })

  it('sends nothing for an unchanged snapshot and a timestamp-only delta for reasoning', () => {
    const stream = createCodexContentStream()
    stream.update({ id: 'r', type: 'reasoning', text: 'think', startedAt: 1, endedAt: 2 })
    expect(stream.update({ id: 'r', type: 'reasoning', text: 'think', startedAt: 1, endedAt: 2 })).toEqual([])
    expect(stream.update({ id: 'r', type: 'reasoning', text: 'think', startedAt: 1, endedAt: 5 })).toEqual([
      { delta: { type: 'thinking', id: 'r', thinking: '', parentToolUseId: null, startedAt: 1, endedAt: 5 } },
    ])
  })

  it('streams command output then lets the result replace the preview', () => {
    const running = (aggregatedOutput: string): CodexThreadItem => ({ id: 'c', type: 'command_execution', command: 'make', aggregatedOutput, status: 'in_progress' })
    const content = streamAll([running(''), running('step 1\n'), running('step 1\nstep 2\n'),
      { id: 'c', type: 'command_execution', command: 'make', aggregatedOutput: 'step 1\nstep 2\n', exitCode: 0, status: 'completed' }])
    expect(content[0]).toMatchObject({ toolName: 'Bash', status: 'complete' })
    expect(content[0]).not.toHaveProperty('liveOutput')
    expect(content[1]).toMatchObject({ type: 'tool_result', summary: 'step 1\nstep 2\n', exitCode: 0 })
  })

  it('reduces a collab card with late children to its projection', () => {
    const base: CodexCollabToolCallItem = { id: 's', type: 'collab_tool_call', tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['child'], agentsStates: { child: { status: 'running' } } }
    const done: CodexCollabToolCallItem = { ...base, agentsStates: { child: { status: 'completed', message: 'ok' } },
      childItems: { child: [{ id: 'm', type: 'agent_message', text: 'ok' }] } }
    const streamed = streamAll([base, { ...base, childItems: { child: [{ id: 'm', type: 'agent_message', text: 'o' }] } }, done])
    expect(streamed.map(block => JSON.parse(JSON.stringify({ ...block, toolSummary: undefined, startedAt: undefined }))))
      .toEqual(codexItemsToContent([done]).map(block => JSON.parse(JSON.stringify(block))))
  })
})
