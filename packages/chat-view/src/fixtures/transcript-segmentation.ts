import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { buildCompactBoundaryMessage } from '@superone/shared/compact-boundary'
import { anchorAsyncAnswer } from '@superone/shared/transcript-boundary'

/** An answer accepted halfway through a sentence; subsequent deltas keep its block identity. */
export function streamingAsyncAnswerHistory(stage = 0): ChatMessage[] {
  const prefix = '找到了两处提示：边缘的“Load earlier / Load later”按钮，以及长消息顶部的“'
  const source: ChatMessage = { id: 'streaming-async-turn', role: 'assistant', providerId: 'codex',
    status: 'streaming', createdAt: '', content: [{ type: 'text', id: 'reply', text: prefix }] }
  const answer = anchorAsyncAnswer({ id: 'codex_async_answer:streaming-question', role: 'user', providerId: 'codex',
    status: 'complete', createdAt: '', content: [{ type: 'text', text: '只显示 Loading 动画，加载前后不显示任何提示',
      codexAsyncQuestions: [{ title: '历史加载区是否要完全隐藏非加载状态？', options: null }] }] }, [source])
  if (stage > 0) source.content = [{ type: 'text', id: 'reply', text: prefix + '更早部分”文字。我会去掉这些提示。' }]
  if (stage > 1) source.content.push(
    { type: 'thinking', id: 'reasoning', thinking: '检查历史加载逻辑。' },
    { type: 'tool_use', toolUseId: 'read', toolName: 'Read', input: '{"file_path":"src/history.ts"}', status: 'complete' },
    { type: 'tool_result', toolUseId: 'read', summary: 'History loading verified.' },
    { type: 'text', id: 'next', text: '明白，加载前后都不显示任何提示。' },
  )
  return [source, answer]
}

/** A completed turn with a small process continuation after automatic compaction. */
export function compactProcessHistory(): ChatMessage[] {
  const tool = (id: string): ContentBlock => ({ type: 'tool_use', toolUseId: id, toolName: 'Bash',
    input: JSON.stringify({ command: `echo ${id}` }), status: 'complete' })
  const source: ChatMessage = { id: 'compact-process', role: 'assistant', providerId: 'codex',
    status: 'streaming', createdAt: '2026-10-13T00:00:00Z', content: [
      ...Array.from({ length: 4 }, (_, i) => tool(`before-${i}`)),
      { type: 'text', text: 'Continuing the implementation.' },
      tool('before-compact'),
    ] }
  const compact = buildCompactBoundaryMessage({ type: 'compact_boundary', trigger: 'auto', preTokens: 120_000, postTokens: 20_000 },
    'process-compact', source.createdAt, source, [source])
  return [{ ...source, status: 'complete', content: [...source.content,
    tool('after-compact'), { type: 'thinking', thinking: 'Verify the completed change.', startedAt: 1, endedAt: 1001 },
    { type: 'text', text: 'The implementation is ready.' },
  ] }, compact]
}

export function segmentationHistory(codex: boolean): ChatMessage[] {
  const source: ChatMessage = { id: 'segmented-turn', role: 'assistant', status: 'streaming', createdAt: '',
    providerId: codex ? 'codex' : 'claude', content: codex ? [] : [{ type: 'text', text: 'Before the first compaction.\n\n' }],
    ...(codex ? { metadata: { codex: { threadId: 'thread', usage: null, items: [
      { id: 'before', type: 'agent_message', text: 'Before answering the question.' },
      { id: 'question', type: 'agent_message', text: '', delivery: 'async', questions: [{ title: 'Which environment?', options: ['Production', 'Development'] }] },
    ] } } } : {}) }
  if (codex) {
    const answer = anchorAsyncAnswer({ id: 'codex_async_answer:question', role: 'user', status: 'complete', providerId: 'codex', createdAt: '',
      content: [{ type: 'text', text: 'Production', codexAsyncQuestions: [{ title: 'Which environment?', options: ['Production', 'Development'] }] }] }, [source])
    const updated: ChatMessage = { ...source, status: 'complete', metadata: { codex: { ...source.metadata!.codex!, items: [
      ...source.metadata!.codex!.items,
      { id: 'after', type: 'agent_message', text: 'After the answer: inspecting production.' },
      { id: 'read', type: 'command_execution', command: 'cat production.ts', aggregatedOutput: 'Configuration verified.', status: 'completed', exitCode: 0 },
      { id: 'final', type: 'agent_message', text: 'The production configuration is ready.' },
    ] } } }
    return [updated, answer]
  }
  const first = buildCompactBoundaryMessage({ type: 'compact_boundary', trigger: 'auto', preTokens: 120_000, postTokens: 20_000 }, 'first-compact', '', source, [source])
  const middle: ChatMessage = { ...source, content: [{ type: 'text', text: 'Before the first compaction.\n\nBetween both compactions.\n\n' }] }
  const second = buildCompactBoundaryMessage({ type: 'compact_boundary', trigger: 'auto', preTokens: 130_000, postTokens: 21_000 }, 'second-compact', '', middle, [first, middle])
  return [first, second, { ...middle, status: 'complete', content: [{ type: 'text', text: 'Before the first compaction.\n\nBetween both compactions.\n\nAfter the second compaction.' }] }]
}
