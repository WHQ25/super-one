import { describe, expect, it } from 'vitest'
import { readNumberedPick, typeNumberedPick } from './numbered-pick'

describe('readNumberedPick', () => {
  it('picks at once when no longer number exists', () => {
    expect(readNumberedPick('3', 4)).toEqual({ kind: 'pick', index: 2 })
    expect(readNumberedPick('5', 23)).toEqual({ kind: 'pick', index: 4 })
    expect(readNumberedPick('23', 23)).toEqual({ kind: 'pick', index: 22 })
  })

  it('waits on a prefix of a longer number, keeping its own option as the fallback', () => {
    expect(readNumberedPick('2', 23)).toEqual({ kind: 'wait', index: 1 })
    expect(readNumberedPick('1', 10)).toEqual({ kind: 'wait', index: 0 })
    expect(readNumberedPick('10', 100)).toEqual({ kind: 'wait', index: 9 })
  })

  it('rejects zero, leading zeros and numbers past the list', () => {
    expect(readNumberedPick('0', 23)).toEqual({ kind: 'none' })
    expect(readNumberedPick('05', 23)).toEqual({ kind: 'none' })
    expect(readNumberedPick('24', 23)).toEqual({ kind: 'none' })
    expect(readNumberedPick('', 23)).toEqual({ kind: 'none' })
  })
})

describe('typeNumberedPick', () => {
  it('completes a two-digit number', () => {
    const first = typeNumberedPick('', '2', 23)
    expect(first).toEqual({ digits: '2', read: { kind: 'wait', index: 1 } })
    expect(typeNumberedPick(first.digits, '3', 23)).toEqual({ digits: '', read: { kind: 'pick', index: 22 } })
  })

  it('starts over when the next digit cannot continue the number', () => {
    expect(typeNumberedPick('2', '7', 23)).toEqual({ digits: '', read: { kind: 'pick', index: 6 } })
    expect(typeNumberedPick('2', '1', 23)).toEqual({ digits: '', read: { kind: 'pick', index: 20 } })
    expect(typeNumberedPick('2', '0', 23)).toEqual({ digits: '', read: { kind: 'pick', index: 19 } })
    expect(typeNumberedPick('', '0', 23)).toEqual({ digits: '', read: { kind: 'none' } })
  })
})
