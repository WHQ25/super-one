import { describe, expect, it } from 'vitest'
import {
  formatSendWhen,
  nextOccurrenceOf,
  toTimeInputValue,
  withDate,
  withTime,
} from './scheduled-send-time'

const NOON = new Date(2026, 0, 1, 12, 0, 0).getTime()

describe('scheduled send time field', () => {
  it('round-trips a time later on the same day', () => {
    const at = new Date(2026, 0, 1, 14, 30, 0).getTime()
    expect(toTimeInputValue(at)).toBe('14:30')
    expect(withTime(NOON, '14:30', NOON)).toBe(at)
  })

  it('rolls a time that has already passed to the next day', () => {
    expect(withTime(NOON, '09:00', NOON)).toBe(new Date(2026, 0, 2, 9, 0, 0).getTime())
  })

  it('treats the current minute as passed rather than due now', () => {
    expect(withTime(NOON, '12:00', NOON)).toBe(new Date(2026, 0, 2, 12, 0, 0).getTime())
  })

  it('leaves a time alone when the day it lands on is already ahead', () => {
    const nextWeek = new Date(2026, 0, 8, 20, 0, 0).getTime()
    expect(withTime(nextWeek, '09:00', NOON)).toBe(new Date(2026, 0, 8, 9, 0, 0).getTime())
  })

  it('pads single-digit hours so the field stays valid', () => {
    expect(toTimeInputValue(new Date(2026, 0, 1, 9, 5, 0).getTime())).toBe('09:05')
  })

  it('rejects anything an empty or half-typed field can produce', () => {
    expect(withTime(NOON, '', NOON)).toBeNull()
    expect(withTime(NOON, '14:', NOON)).toBeNull()
    expect(withTime(NOON, '25:00', NOON)).toBeNull()
    expect(withTime(NOON, '12:60', NOON)).toBeNull()
  })
})

describe('scheduled send time field, keystroke by keystroke', () => {
  it('does not compound the roll across a segmented time input', () => {
    // Chromium emits a change per segment, so typing 10:30 at 08:00 passes
    // through 01:00 — past, and rolled to tomorrow. Anchoring every keystroke to
    // the day editing began on is what keeps the finished value on today.
    const eight = new Date(2026, 0, 1, 8, 0, 0).getTime()
    const anchor = eight
    expect(withTime(anchor, '01:00', eight)).toBe(new Date(2026, 0, 2, 1, 0, 0).getTime())
    expect(withTime(anchor, '10:00', eight)).toBe(new Date(2026, 0, 1, 10, 0, 0).getTime())
    expect(withTime(anchor, '10:30', eight)).toBe(new Date(2026, 0, 1, 10, 30, 0).getTime())
  })
})

describe('scheduled send date field', () => {
  it('moves the day and keeps the time of day already chosen', () => {
    const at = new Date(2026, 0, 1, 14, 30, 0).getTime()
    expect(withDate(at, new Date(2026, 2, 9))).toBe(new Date(2026, 2, 9, 14, 30, 0).getTime())
  })

  it('crosses a month boundary without dragging the old month along', () => {
    const at = new Date(2026, 0, 31, 8, 0, 0).getTime()
    expect(withDate(at, new Date(2026, 1, 3))).toBe(new Date(2026, 1, 3, 8, 0, 0).getTime())
  })
})

describe('how an instant reads', () => {
  it('shows the time alone when it lands today', () => {
    const at = new Date(2026, 0, 1, 14, 30, 0).getTime()
    expect(formatSendWhen(at, NOON)).toBe('14:30')
  })

  it('adds the day once the time alone would be ambiguous', () => {
    // A quota window reopening tomorrow morning must not read as this morning.
    const at = new Date(2026, 0, 2, 9, 0, 0).getTime()
    expect(formatSendWhen(at, NOON)).toMatch(/9.*09:00|09:00/)
    expect(formatSendWhen(at, NOON)).not.toBe('09:00')
  })
})

describe('a picked time that has slipped behind the clock', () => {
  it('leaves a time that is still ahead exactly where it is', () => {
    const later = new Date(2026, 0, 1, 15, 30, 0).getTime()
    expect(nextOccurrenceOf(later, NOON)).toBe(later)
  })

  it('rolls a time that has passed to the same time of day tomorrow', () => {
    const earlier = new Date(2026, 0, 1, 9, 30, 0).getTime()
    // The user picked 09:30, not "three hours from whenever I click" — the
    // hour is the choice worth keeping.
    expect(nextOccurrenceOf(earlier, NOON)).toBe(new Date(2026, 0, 2, 9, 30, 0).getTime())
  })

  it('lands on today when the time of day is still ahead of a days-old pick', () => {
    const stale = new Date(2025, 11, 20, 15, 30, 0).getTime()
    expect(nextOccurrenceOf(stale, NOON)).toBe(new Date(2026, 0, 1, 15, 30, 0).getTime())
  })

  it('treats this exact instant as passed, since a row due now fires on the next poll', () => {
    expect(nextOccurrenceOf(NOON, NOON)).toBe(new Date(2026, 0, 2, 12, 0, 0).getTime())
  })
})
