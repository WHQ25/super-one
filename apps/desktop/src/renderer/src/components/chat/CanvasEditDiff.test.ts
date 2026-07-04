/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest'
import {
  greedyLineDiff,
  snapCommittedLines,
  buildDisplayLines,
  type LineEvent,
} from './CanvasEditDiff'

describe('snapCommittedLines', () => {
  it('returns empty when streaming has no newline yet', () => {
    expect(snapCommittedLines('impor', false)).toEqual([])
    expect(snapCommittedLines('', false)).toEqual([])
  })

  it('returns committed full lines during streaming and drops the still-typing tail', () => {
    expect(snapCommittedLines('line1\nlin', false)).toEqual(['line1'])
    expect(snapCommittedLines('a\nb\nc', false)).toEqual(['a', 'b'])
    expect(snapCommittedLines('a\n', false)).toEqual(['a'])
  })

  it('returns all lines when the stream is done, dropping trailing empty from a final newline', () => {
    expect(snapCommittedLines('a\nb\n', true)).toEqual(['a', 'b'])
    expect(snapCommittedLines('a\nb', true)).toEqual(['a', 'b'])
    expect(snapCommittedLines('', true)).toEqual([])
  })
})

describe('greedyLineDiff', () => {
  it('emits a match when the incoming line equals old[cursor]', () => {
    const ev = greedyLineDiff(['a', 'b'], ['a'], false)
    expect(ev).toEqual([{ kind: 'match', newLineIdx: 0, oldLineIdx: 0, text: 'a' }])
  })

  it('emits added when the incoming line is not found in remaining old', () => {
    const ev = greedyLineDiff(['a', 'b'], ['c'], false)
    expect(ev).toEqual([{ kind: 'added', newLineIdx: 0, text: 'c' }])
  })

  it('skip-matches: deletes the lines between cursor and a later match', () => {
    const ev = greedyLineDiff(['a', 'b', 'c', 'd'], ['a', 'd'], false)
    expect(ev).toEqual([
      { kind: 'match', newLineIdx: 0, oldLineIdx: 0, text: 'a' },
      { kind: 'deleted', oldLineIdx: 1, text: 'b' },
      { kind: 'deleted', oldLineIdx: 2, text: 'c' },
      { kind: 'match', newLineIdx: 1, oldLineIdx: 3, text: 'd' },
    ])
  })

  it('does not emit deletes for still-unmatched tail of old while streaming', () => {
    const ev = greedyLineDiff(['a', 'b', 'c'], ['a'], false)
    expect(ev).toEqual([
      { kind: 'match', newLineIdx: 0, oldLineIdx: 0, text: 'a' },
    ])
  })

  it('flushes remaining old as deletes when the stream finishes', () => {
    const ev = greedyLineDiff(['a', 'b', 'c'], ['a'], true)
    expect(ev).toEqual([
      { kind: 'match', newLineIdx: 0, oldLineIdx: 0, text: 'a' },
      { kind: 'deleted', oldLineIdx: 1, text: 'b' },
      { kind: 'deleted', oldLineIdx: 2, text: 'c' },
    ])
  })

  it('handles a pure insertion block amid existing lines', () => {
    const ev = greedyLineDiff(['a', 'b'], ['a', 'x', 'b'], true)
    expect(ev).toEqual([
      { kind: 'match', newLineIdx: 0, oldLineIdx: 0, text: 'a' },
      { kind: 'added', newLineIdx: 1, text: 'x' },
      { kind: 'match', newLineIdx: 2, oldLineIdx: 1, text: 'b' },
    ])
  })

  it('does not rewind cursor after consuming a match', () => {
    const ev = greedyLineDiff(['a', 'b'], ['b', 'a'], true)
    expect(ev).toEqual([
      { kind: 'deleted', oldLineIdx: 0, text: 'a' },
      { kind: 'match', newLineIdx: 0, oldLineIdx: 1, text: 'b' },
      { kind: 'added', newLineIdx: 1, text: 'a' },
    ])
  })
})

describe('buildDisplayLines', () => {
  it('places events in order and appends unconsumed old as oldPending', () => {
    const oldLines = ['a', 'b', 'c', 'd']
    const events: LineEvent[] = [
      { kind: 'match', newLineIdx: 0, oldLineIdx: 0, text: 'a' },
      { kind: 'added', newLineIdx: 1, text: 'x' },
    ]
    const display = buildDisplayLines(events, oldLines, null, null)
    expect(display.map((d) => ({ kind: d.kind, text: d.text }))).toEqual([
      { kind: 'match', text: 'a' },
      { kind: 'added', text: 'x' },
      { kind: 'oldPending', text: 'b' },
      { kind: 'oldPending', text: 'c' },
      { kind: 'oldPending', text: 'd' },
    ])
  })

  it('skips consumed old lines (including deleted) from the pending tail', () => {
    const oldLines = ['a', 'b', 'c']
    const events: LineEvent[] = [
      { kind: 'match', newLineIdx: 0, oldLineIdx: 0, text: 'a' },
      { kind: 'deleted', oldLineIdx: 1, text: 'b' },
    ]
    const display = buildDisplayLines(events, oldLines, null, null)
    expect(display.map((d) => d.kind)).toEqual(['match', 'deleted', 'oldPending'])
    expect(display[2].text).toBe('c')
  })

  it('numbers display lines sequentially starting at 1', () => {
    const oldLines = ['a', 'b']
    const events: LineEvent[] = [{ kind: 'added', newLineIdx: 0, text: 'x' }]
    const display = buildDisplayLines(events, oldLines, null, null)
    expect(display.map((d) => d.lineNum)).toEqual([1, 2, 3])
  })

  it('keeps stable keys so that old lines retain identity through kind changes', () => {
    const oldLines = ['a', 'b']
    const pending = buildDisplayLines([], oldLines, null, null)
    expect(pending.map((d) => d.key)).toEqual(['old:0', 'old:1'])

    const afterMatch = buildDisplayLines(
      [{ kind: 'match', newLineIdx: 0, oldLineIdx: 0, text: 'a' }],
      oldLines, null, null,
    )
    expect(afterMatch.map((d) => d.key)).toEqual(['old:0', 'old:1'])

    const added = buildDisplayLines([{ kind: 'added', newLineIdx: 0, text: 'x' }], oldLines, null, null)
    expect(added.map((d) => d.key)).toEqual(['new:0', 'old:0', 'old:1'])
  })
})

