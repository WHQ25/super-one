import { expect, test } from 'vitest'
import { parseScheduledSendTime, scheduledSendFields } from './scheduled-send-time'

test('round-trips local wall time and rejects rollover dates and invalid times', () => {
  const value = new Date(2026, 9, 12, 18, 30).getTime()
  const fields = scheduledSendFields(value)
  expect(parseScheduledSendTime(fields.day, fields.time)).toBe(value)
  expect(parseScheduledSendTime('2026-02-30', '12:00')).toBeNull()
  expect(parseScheduledSendTime('2026-10-12', '24:00')).toBeNull()
  expect(parseScheduledSendTime('2026-10-12', '12:60')).toBeNull()
  expect(parseScheduledSendTime('10/12', '18:30')).toBeNull()
})
