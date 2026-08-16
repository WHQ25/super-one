import { describe, expect, it } from 'vitest'
import { debugMentionGhostPrefix, type DebugGhostPiece } from './debug-mention-ghost'

describe('debugMentionGhostPrefix', () => {
  it('is hidden when there is no debug mention', () => {
    expect(debugMentionGhostPrefix([{ type: 'text', text: 'hello' }])).toBeNull()
    expect(debugMentionGhostPrefix([{ type: 'mention', kind: 'widget' }])).toBeNull()
    expect(debugMentionGhostPrefix([])).toBeNull()
  })

  it('asks for a leading space right after a lone debug chip', () => {
    expect(debugMentionGhostPrefix([{ type: 'mention', kind: 'debug' }])).toBe(' ')
  })

  it('keeps the ghost when only trailing whitespace follows the chip', () => {
    const pieces: DebugGhostPiece[] = [
      { type: 'mention', kind: 'debug' },
      { type: 'text', text: '  ' },
    ]
    expect(debugMentionGhostPrefix(pieces)).toBe('')
  })

  it('hides once the user types after the chip', () => {
    const pieces: DebugGhostPiece[] = [
      { type: 'mention', kind: 'debug' },
      { type: 'text', text: ' app crashed' },
    ]
    expect(debugMentionGhostPrefix(pieces)).toBeNull()
  })

  it('hides when another chip or attachment follows debug', () => {
    expect(debugMentionGhostPrefix([
      { type: 'mention', kind: 'debug' },
      { type: 'mention', kind: 'file' },
    ])).toBeNull()
    expect(debugMentionGhostPrefix([
      { type: 'mention', kind: 'debug' },
      { type: 'other' },
    ])).toBeNull()
  })

  it('still shows after a leading file chip, as long as debug is last', () => {
    expect(debugMentionGhostPrefix([
      { type: 'mention', kind: 'file' },
      { type: 'text', text: ' ' },
      { type: 'mention', kind: 'debug' },
    ])).toBe(' ')
  })

  it('ignores a later line after a hard break', () => {
    expect(debugMentionGhostPrefix([
      { type: 'mention', kind: 'debug' },
      { type: 'hardBreak' },
      { type: 'text', text: 'typed on line 2' },
    ])).toBe(' ')
  })

  it('resets to the last debug chip on the first line', () => {
    expect(debugMentionGhostPrefix([
      { type: 'mention', kind: 'debug' },
      { type: 'text', text: ' stale' },
      { type: 'mention', kind: 'debug' },
    ])).toBe(' ')
  })
})
