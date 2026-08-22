import { describe, expect, it } from 'vitest'
import { resolveHeldDevice } from './target'
import { DeviceAgentError } from './types'

const CLIENT = { id: 'ios-sim:p17-265', name: 'iPhone 17 Pro Max' }
const MERCHANT = { id: 'android:emulator-5554', name: 'Medium Phone API 36' }

describe('resolving which device a call meant', () => {
  it('defaults to the one device the session holds, so the common case names nothing', () => {
    expect(resolveHeldDevice([CLIENT], undefined)).toBe(CLIENT.id)
  })

  /**
   * The rule this file exists for.
   *
   * Guessing does not fail loudly here: it taps the merchant app while the agent
   * believes it is in the client app, and every observation afterwards reads as a bug
   * in the app under test. Refusing costs one round trip; guessing costs the session.
   */
  it('refuses to guess between two, and names both so the retry is right', () => {
    let thrown: unknown
    try {
      resolveHeldDevice([CLIENT, MERCHANT], undefined)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(DeviceAgentError)
    expect((thrown as DeviceAgentError).code).toBe('NO_DEVICE')
    expect((thrown as Error).message).toContain(CLIENT.id)
    expect((thrown as Error).message).toContain(MERCHANT.id)
  })

  it('takes the id, the bare native handle, or the name', () => {
    const held = [CLIENT, MERCHANT]
    expect(resolveHeldDevice(held, 'android:emulator-5554')).toBe(MERCHANT.id)
    // A udid read back out of `simctl` or copied from a log carries no prefix.
    expect(resolveHeldDevice(held, 'p17-265')).toBe(CLIENT.id)
    expect(resolveHeldDevice(held, 'iPhone 17 Pro Max')).toBe(CLIENT.id)
    // ...and what the user said in chat, which is rarely the whole name.
    expect(resolveHeldDevice(held, 'Medium Phone')).toBe(MERCHANT.id)
  })

  it('refuses a device the session was never granted, rather than reaching for it', () => {
    // A loose match must never widen into the catalog. Only devices the user actually
    // approved are candidates, so a near-miss is a refusal and not a different phone.
    expect(() => resolveHeldDevice([CLIENT], 'iPad Pro')).toThrow(/does not control/)
  })

  it('says how to get a device when the session holds none', () => {
    expect(() => resolveHeldDevice([], undefined)).toThrow(/device_request_control/)
  })
})
