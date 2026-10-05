import { describe, expect, it } from 'vitest'
import { resolveComposer } from './resolve-composer'

describe('resolveComposer', () => {
  it('uses text as the base composer', () => {
    expect(resolveComposer({ needsDecision: false, appConsent: false, voiceEngaged: false })).toBe('text')
  })

  it('orders decision above app consent and voice', () => {
    expect(resolveComposer({ needsDecision: true, appConsent: true, voiceEngaged: true })).toBe('decision')
  })

  it('does not show a decision composer when the session cannot accept decisions', () => {
    expect(resolveComposer({ needsDecision: true, decisionAvailable: false, appConsent: true, voiceEngaged: true })).toBe('app-consent')
  })

  it('orders app consent above voice', () => {
    expect(resolveComposer({ needsDecision: false, appConsent: true, voiceEngaged: true })).toBe('app-consent')
  })

  it('shows voice above the base composer', () => {
    expect(resolveComposer({ needsDecision: false, appConsent: false, voiceEngaged: true })).toBe('voice')
  })

  it('places app input below decisions and consent but above native and voice modes', () => {
    const inputs = { needsDecision: false, appConsent: false, appInput: true, voiceEngaged: true, openedComposerId: 'superone.image' }
    expect(resolveComposer(inputs)).toBe('app-input')
    expect(resolveComposer({ ...inputs, needsDecision: true })).toBe('decision')
    expect(resolveComposer({ ...inputs, appConsent: true })).toBe('app-consent')
    expect(resolveComposer({ ...inputs, decisionAvailable: false })).toBe('voice')
  })

  it('keeps decisions and app consent above an explicitly opened mode', () => {
    const inputs = { needsDecision: false, appConsent: false, voiceEngaged: true, openedComposerId: 'superone.image' }
    expect(resolveComposer(inputs)).toBe('superone.image')
    expect(resolveComposer({ ...inputs, appConsent: true })).toBe('app-consent')
    expect(resolveComposer({ ...inputs, needsDecision: true })).toBe('decision')
    expect(resolveComposer({ ...inputs, decisionAvailable: false })).toBe('voice')
  })
})
