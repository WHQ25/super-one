import { describe, expect, it } from 'vitest'
import { applyEventToSession, createDefaultChatCoreSession, type ChatCoreSession } from '@superone/chat-core'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { codexItemsToContent } from '@superone/shared/codex-content'
import { sealCodexItems } from '@superone/shared/content-delta'
import { CODEX_RECORDINGS, readCodexRecording, replayCodexRecordedTurnWithItems } from '@superone/codex/fixtures/recordings'

/** A turn as it renders: block order per parent and each call's result, without timing fields. */
function rendered(content: ContentBlock[]) {
  const order: Record<string, unknown[]> = {}
  const results: Record<string, unknown> = {}
  for (const block of JSON.parse(JSON.stringify(content)) as ContentBlock[]) {
    for (const key of ['toolSummary', 'startedAt', 'endedAt', 'elapsedSeconds']) delete (block as Record<string, unknown>)[key]
    if (block.type === 'tool_result') { results[block.toolUseId] = block; continue }
    const parent = 'parentToolUseId' in block ? block.parentToolUseId ?? '' : ''
    ;(order[parent] ??= []).push(block)
  }
  return { order, results }
}

/** A recorded Codex turn streamed as content reads, settled, as the projection of its items. */
describe('Codex content turns over recordings', () => {
  const turns = CODEX_RECORDINGS.flatMap(name => readCodexRecording(name).turns.map((_, index) => [name, index] as const))

  it.each(turns)('%s turn %i settles to the projection of its items', (name, index) => {
    const { events, items } = replayCodexRecordedTurnWithItems(readCodexRecording(name), index, 'm1')
    let session: ChatCoreSession = createDefaultChatCoreSession()
    let sawStreamingTool = false
    for (const event of events) {
      session = { ...session, ...applyEventToSession(session, event) }
      const message = session.messages.find(m => m.id === 'm1')
      if (message?.content.some(block => block.type === 'tool_use' && block.status === 'streaming')) sawStreamingTool = true
    }

    const message = session.messages.find(m => m.id === 'm1') as ChatMessage
    expect(message.metadata?.codex?.items ?? []).toEqual([])
    if (name === 'commands') expect(sawStreamingTool).toBe(true)
    expect(message.status).not.toBe('streaming')
    const actual = rendered(message.content)
    const expected = rendered(codexItemsToContent(sealCodexItems(items)))
    // A stopped call is sealed without a result; the legacy item seal added an empty one.
    if (message.status === 'complete') expect(actual).toEqual(expected)
    else expect(actual.order).toEqual(expected.order)
    expect(message.content.some(block => block.type === 'tool_use' && block.status === 'streaming'
      && block.toolName !== 'ImageGeneration')).toBe(false)
  })
})
