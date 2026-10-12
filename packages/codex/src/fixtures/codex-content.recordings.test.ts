import { describe, expect, it } from 'vitest'
import type { AgentEvent, ContentBlock } from '@superone/shared/agent-types'
import { applyContentDelta } from '@superone/shared/content-delta'
import { codexItemsToContent } from '@superone/shared/codex-content'
import { CODEX_RECORDINGS, readCodexRecording, replayCodexRecordedTurn, replayCodexRecordedTurnWithItems } from './recordings'

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

/** The content a turn's own content deltas build. */
function streamedContent(events: AgentEvent[]): ContentBlock[] {
  let content: ContentBlock[] = []
  for (const event of events) {
    if (event.type === 'content_delta') content = applyContentDelta(content, event.delta, () => 0, { replace: event.replace })
  }
  return content
}

describe('Codex content stream over recorded turns', () => {
  it.each(CODEX_RECORDINGS)('%s: the mapper\'s content deltas reduce to the projection of its final items', (name) => {
    const recording = readCodexRecording(name)
    recording.turns.forEach((_, index) => {
      const { events, items } = replayCodexRecordedTurnWithItems(recording, index)
      const projected = codexItemsToContent(items).map(block => 'toolName' in block ? { ...block, startedAt: 0 } : block)
      expect(rendered(streamedContent(events))).toEqual(rendered(projected))
      if (items.length) expect(events.some(event => event.type === 'content_delta')).toBe(true)
    })
  })

  it('streams agent text as suffixes, not full snapshots', () => {
    const texts: string[] = []
    for (const event of replayCodexRecordedTurn(readCodexRecording('commands'), 0)) {
      if (event.type !== 'content_delta' || event.delta.type !== 'text') continue
      expect(event.replace).toBeUndefined()
      texts.push(event.delta.text)
    }
    const longest = Math.max(...texts.map(text => text.length))
    const total = texts.join('').length
    expect(texts.length).toBeGreaterThan(10)
    expect(longest).toBeLessThan(total / 2)
  })
})
