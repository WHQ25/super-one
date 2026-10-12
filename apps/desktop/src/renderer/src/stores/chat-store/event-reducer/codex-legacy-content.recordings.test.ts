import { describe, expect, it } from 'vitest'
import { applyEventToSession, createDefaultChatCoreSession, type ChatCoreSession } from '@superone/chat-core'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { codexItemsToContent } from '@superone/shared/codex-content'
import { sealCodexItems } from '@superone/shared/content-delta'
import { CODEX_RECORDINGS, readCodexRecording, replayCodexRecordedTurn } from '@superone/codex/fixtures/recordings'

/** Legacy Codex streams (full items per delta) reduce to content derived from the items. */
describe('legacy Codex stream ingress over recordings', () => {
  const turns = CODEX_RECORDINGS.flatMap(name => readCodexRecording(name).turns.map((_, index) => [name, index] as const))

  it.each(turns)('%s turn %i derives content after every write', (name, index) => {
    const recording = readCodexRecording(name)
    let session: ChatCoreSession = createDefaultChatCoreSession()
    const contents: ContentBlock[][] = []
    for (const event of replayCodexRecordedTurn(recording, index, 'm1')) {
      session = { ...session, ...applyEventToSession(session, event) }
      const message = session.messages.find(m => m.id === 'm1')
      if (event.type === 'codex_item_delta' && message) contents.push(message.content)
    }

    const message = session.messages.find(m => m.id === 'm1') as ChatMessage
    const items = message.metadata?.codex?.items ?? []
    if (!items.length) {
      expect(contents).toEqual([])
      return
    }
    // Every legacy delta re-derives the live projection, which is never sealed.
    expect(contents.length).toBeGreaterThan(0)
    if (name === 'commands') expect(contents.some(content => content.some(block => block.type === 'tool_use' && block.status === 'streaming'))).toBe(true)
    expect(message.status).not.toBe('streaming')
    // The completion's final-response overwrite is re-derived away; the turn reads as its items.
    expect(message.content).toEqual(codexItemsToContent(sealCodexItems(items)))
    expect(message.content.some(block => block.type === 'text' && block.id === undefined)).toBe(false)
    expect(message.content.some(block => block.type === 'tool_use' && block.status === 'streaming'
      && block.toolName !== 'ImageGeneration')).toBe(false)
  })
})
