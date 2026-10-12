import type { ChatMessage } from '../agent-types'
import { MessageFragmenter } from './fragment-message'
import type { WindowSource } from './select-window'

/** Deterministic transcripts for transcript-window tests and benchmarks. */

export function textMessage(id: string, role: ChatMessage['role'], text: string, status: ChatMessage['status'] = 'complete'): ChatMessage {
  return { id, role, status, createdAt: '2026-10-13T00:00:00.000Z', providerId: 'claude', content: [{ type: 'text', text }] }
}

/** About `bytes` of Markdown prose with a fence and a table, as one reply. */
export function longReplyText(bytes: number): string {
  const parts: string[] = []
  let size = 0
  for (let i = 0; size < bytes; i++) {
    const part = i % 10 === 3
      ? `\`\`\`ts\n${Array.from({ length: 40 }, (_, n) => `export const value${i}_${n} = ${n} // line ${n}`).join('\n')}\n\`\`\``
      : i % 10 === 7
        ? `| Column | Value |\n| --- | --- |\n${Array.from({ length: 30 }, (_, n) => `| row ${n} | ${i * n} |`).join('\n')}`
        : `Paragraph ${i}: ${'The reply keeps explaining the change in detail. '.repeat(6)}`
    parts.push(part)
    size += part.length + 2
  }
  return parts.join('\n\n')
}

/** A turn of many tool calls and results. */
export function toolTurn(id: string, tools: number): ChatMessage {
  return {
    id, role: 'assistant', status: 'complete', createdAt: '2026-10-13T00:00:00.000Z', providerId: 'claude',
    content: Array.from({ length: tools }, (_, i) => [
      { type: 'text' as const, text: `Step ${i}: checking the next file.` },
      { type: 'tool_use' as const, toolName: 'Read', toolUseId: `${id}_t${i}`, input: JSON.stringify({ file_path: `/src/file${i}.ts` }), status: 'complete' as const },
      { type: 'tool_result' as const, toolUseId: `${id}_t${i}`, summary: `read ${i * 10} lines` },
    ]).flat(),
  }
}

/** Alternating user / assistant messages. */
export function conversation(count: number, prefix = 'm'): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => textMessage(`${prefix}${i}`, i % 2 ? 'assistant' : 'user', `Message ${i}. ${'Some words. '.repeat(20)}`))
}

/** A window source over plain messages, fragmenting lazily. */
export function windowSource(messages: ChatMessage[], fragmenter = new MessageFragmenter()): WindowSource & { calls: number[] } {
  const calls: number[] = []
  const cache = new Map<number, ReturnType<MessageFragmenter['fragment']>>()
  return {
    calls,
    count: messages.length,
    at(index) {
      let fragments = cache.get(index)
      if (!fragments) {
        calls.push(index)
        fragments = fragmenter.fragment(messages[index])
        cache.set(index, fragments)
      }
      return fragments
    },
    indexOf: (messageId) => messages.findIndex((message) => message.id === messageId),
  }
}
