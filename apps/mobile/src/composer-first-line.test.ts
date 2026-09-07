import { describe, expect, it } from 'vitest'
import { firstLine, firstLineRange, replaceFirstLine } from './composer-first-line'

describe('firstLineRange', () => {
  it('covers the whole draft when there is no newline', () => {
    expect(firstLineRange('/review')).toEqual({ start: 0, end: 7 })
  })

  it('stops before the newline', () => {
    expect(firstLineRange('/review\nplus context')).toEqual({ start: 0, end: 7 })
  })

  it('is empty for a draft that opens with a newline', () => {
    expect(firstLineRange('\nsecond')).toEqual({ start: 0, end: 0 })
  })

  it('is empty for an empty draft', () => {
    expect(firstLineRange('')).toEqual({ start: 0, end: 0 })
  })
})

describe('firstLine', () => {
  it('drops everything from the newline on', () => {
    expect(firstLine('/re\nsecond\nthird')).toBe('/re')
  })
})

describe('replaceFirstLine', () => {
  it('keeps the rest of the draft, newline included', () => {
    expect(replaceFirstLine('/re\nsecond line', '/review ')).toBe('/review \nsecond line')
  })

  it('keeps a trailing object replacement character untouched', () => {
    // ￼ marks a mention chip in the native editor's flat text. A chip on a
    // later line must survive a command selection on the first.
    expect(replaceFirstLine('/re\nsee ￼', '/review ')).toBe('/review \nsee ￼')
  })

  it('replaces the whole draft when there is no newline', () => {
    expect(replaceFirstLine('/re', '/review ')).toBe('/review ')
  })

  it('prepends when the draft opens with a newline', () => {
    expect(replaceFirstLine('\nbody', '/review ')).toBe('/review \nbody')
  })
})
