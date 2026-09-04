import { describe, expect, it } from 'vitest'
import { InFlightKeys } from './in-flight-keys'

describe('InFlightKeys', () => {
  it('coalesces one key until the operation releases it', () => {
    const inFlight = new InFlightKeys()
    expect(inFlight.acquire('file')).toBe(true)
    expect(inFlight.acquire('file')).toBe(false)
    expect(inFlight.acquire('other')).toBe(true)
    inFlight.release('file')
    expect(inFlight.acquire('file')).toBe(true)
  })
})
