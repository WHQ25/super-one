import { expect, test } from 'vitest'
import { chipTriggerBackground } from './chip-metrics'

const MUTED = '#262626'

test('a chip at rest adds no background of its own', () => {
  expect(chipTriggerBackground({ pressed: false, open: false }, MUTED)).toBe('transparent')
})

test('an open chip stays lit, which is what the disclosure arrow used to say', () => {
  // The model and permission chips dropped their chevrons for the width. With
  // the arrow gone this is the only thing saying the menu belongs to this chip.
  expect(chipTriggerBackground({ pressed: false, open: true }, MUTED)).toBe(MUTED)
})

test('touch feedback still reads on a chip that is not open', () => {
  expect(chipTriggerBackground({ pressed: true, open: false }, MUTED)).toBe(MUTED)
})
