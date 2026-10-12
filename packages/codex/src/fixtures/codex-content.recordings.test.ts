import { describe, expect, it } from 'vitest'
import type { CodexThreadItem, ContentBlock } from '@superone/shared/agent-types'
import { applyContentDelta } from '@superone/shared/content-delta'
import { codexItemsToContent, createCodexContentStream } from '@superone/shared/codex-content'
import { CODEX_RECORDINGS, readCodexRecording, replayCodexRecordedTurn } from './recordings'

/**
 * What a turn renders, independent of where results sit in the flat array:
 * block order per parent, plus each call's result.
 */
function rendered(content: ContentBlock[]) {
  const order: Record<string, unknown[]> = {}
  const results: Record<string, unknown> = {}
  // `applyContentDelta` derives `toolSummary` from the input on an update; rows read the input either way.
  const normalized = JSON.parse(JSON.stringify(content)) as ContentBlock[]
  for (const block of normalized) {
    if ('toolSummary' in block) delete block.toolSummary
    if (block.type === 'tool_result') { results[block.toolUseId] = block; continue }
    const parent = 'parentToolUseId' in block ? block.parentToolUseId ?? '' : ''
    ;(order[parent] ??= []).push(block)
  }
  return { order, results }
}

describe('Codex content stream over recorded turns', () => {
  it.each(CODEX_RECORDINGS)('%s: streamed deltas reduce to the projection of the final items', (name) => {
    const recording = readCodexRecording(name)
    recording.turns.forEach((_, index) => {
      const stream = createCodexContentStream()
      let streamed: ContentBlock[] = []
      const finalItems = new Map<string, CodexThreadItem>()
      let deltas = 0
      for (const event of replayCodexRecordedTurn(recording, index)) {
        if (event.type !== 'codex_item_delta') continue
        finalItems.set(event.item.id, event.item)
        for (const { delta, replace } of stream.update(event.item)) {
          deltas++
          streamed = applyContentDelta(streamed, delta, () => 0, { replace })
        }
      }
      const projected = codexItemsToContent([...finalItems.values()]).map(block => 'toolName' in block ? { ...block, startedAt: 0 } : block)
      expect(rendered(streamed)).toEqual(rendered(projected))
      if (finalItems.size) expect(deltas).toBeGreaterThan(0)
    })
  })

  it('streams agent text as suffixes, not full snapshots', () => {
    const recording = readCodexRecording('commands')
    const stream = createCodexContentStream()
    const texts: string[] = []
    for (const event of replayCodexRecordedTurn(recording, 0)) {
      if (event.type !== 'codex_item_delta') continue
      for (const { delta, replace } of stream.update(event.item)) {
        expect(replace).toBeUndefined()
        if (delta.type === 'text') texts.push(delta.text)
      }
    }
    const longest = Math.max(...texts.map(text => text.length))
    const total = texts.join('').length
    expect(texts.length).toBeGreaterThan(10)
    expect(longest).toBeLessThan(total / 2)
  })
})
