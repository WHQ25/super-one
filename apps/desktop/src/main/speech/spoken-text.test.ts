import { describe, expect, it } from 'vitest'
import { SPOKEN_SEGMENT_CHARS, SPOKEN_TEXT_LIMIT, spokenSegments, spokenText } from './spoken-text'

describe('spokenText', () => {
  it('drops fenced code and keeps the words around it', () => {
    expect(spokenText('See ```js\nconst x = 1\n``` then continue.').text).toBe('See then continue.')
  })

  it('keeps inline code and link labels, and drops images', () => {
    expect(spokenText('Run `bun test` and open [the docs](https://example.com) ![shot](a.png).').text)
      .toBe('Run bun test and open the docs .')
  })

  it('strips heading marks and emphasis', () => {
    expect(spokenText('## Title\n\nA **bold** _note_.').text).toBe('Title A bold note.')
  })

  it('truncates a long reply and flags it', () => {
    const spoken = spokenText('word '.repeat(SPOKEN_TEXT_LIMIT))
    expect(spoken.truncated).toBe(true)
    expect(spoken.text.length).toBeLessThanOrEqual(SPOKEN_TEXT_LIMIT)
  })

  it('keeps a short reply in one segment and splits a long one on sentences', () => {
    expect(spokenSegments('Hello there.')).toEqual(['Hello there.'])
    const segment = 'This is a sentence. '
    const segments = spokenSegments(segment.repeat(Math.ceil((SPOKEN_SEGMENT_CHARS + 20) / segment.length)))
    expect(segments.length).toBeGreaterThan(1)
    expect(segments.every((piece) => piece.length <= SPOKEN_SEGMENT_CHARS)).toBe(true)
  })
})
