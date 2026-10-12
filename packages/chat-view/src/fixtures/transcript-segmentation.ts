import type { ChatMessage } from '@superone/shared/agent-types'
import { buildCompactBoundaryMessage } from '@superone/shared/compact-boundary'
import { anchorAsyncAnswer } from '@superone/shared/transcript-boundary'

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
