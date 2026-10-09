import { describe, expect, it } from 'vitest'
import { isAnyPairingInput, isPairingQrInput, normalizePairingInput } from './pairing-input'

describe('pairing input classification', () => {
  it('recognizes the capitalized scheme emitted by desktop Alpha', () => {
    expect(isPairingQrInput('SuperOne://pair?channel=test')).toBe(true)
  })

  it('rejects JSON fallback input and lookalike pairing hosts', () => {
    expect(isPairingQrInput('{"relayUrl":"wss://relay.example","secret":"x"}')).toBe(false)
    expect(isPairingQrInput('superone://pair-evil?channel=test')).toBe(false)
  })

  it('repairs the space inserted by iOS autocorrection before parsing', () => {
    const normalized = normalizePairingInput('  super one://pair?channel=test  ')

    expect(normalized).toBe('superone://pair?channel=test')
    expect(isPairingQrInput(normalized)).toBe(true)
  })

  it('also routes the desktop-pairing QRs, but nothing else', () => {
    expect(isAnyPairingInput('superone://pair-controller?channel=a')).toBe(true)
    expect(isAnyPairingInput(normalizePairingInput('super one://pair-node?channel=a'))).toBe(true)
    expect(isPairingQrInput('superone://pair-node?channel=a')).toBe(false)
    expect(isAnyPairingInput('superone://pair-evil?channel=a')).toBe(false)
  })
})
