/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isHighRiskPermission,
  leaveDecisionField,
  setDecisionKeyboardPolicy,
  shouldSuppressDecisionShortcut,
} from './decision-composer-policy'

afterEach(() => vi.useRealTimers())

describe('decision composer keyboard policy', () => {
  it('guards shortcut keys briefly after a decision appears', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    setDecisionKeyboardPolicy(root, 'permission:p1', false)

    expect(shouldSuppressDecisionShortcut({ key: 'Enter' } as KeyboardEvent, root)).toBe(true)
    expect(shouldSuppressDecisionShortcut({ key: '2' } as KeyboardEvent, root)).toBe(true)
    expect(shouldSuppressDecisionShortcut({ key: 'Escape' } as KeyboardEvent, root)).toBe(false)

    vi.advanceTimersByTime(501)
    expect(shouldSuppressDecisionShortcut({ key: 'Enter' } as KeyboardEvent, root)).toBe(false)
  })

  it('requires click or Command+Enter for high-risk approvals after the guard window', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    setDecisionKeyboardPolicy(root, 'permission:p2', true)
    vi.advanceTimersByTime(501)

    expect(shouldSuppressDecisionShortcut({ key: 'Enter' } as KeyboardEvent, root)).toBe(true)
    expect(shouldSuppressDecisionShortcut({ key: '1' } as KeyboardEvent, root)).toBe(true)
    expect(shouldSuppressDecisionShortcut({ key: 'Enter', metaKey: true } as KeyboardEvent, root)).toBe(false)
    expect(shouldSuppressDecisionShortcut({ key: 'Tab', shiftKey: true } as KeyboardEvent, root)).toBe(true)
  })

  it('does not change Shift+Tab navigation for ordinary decisions', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    setDecisionKeyboardPolicy(root, 'permission:p3', false)
    vi.advanceTimersByTime(501)

    expect(shouldSuppressDecisionShortcut({ key: 'Tab', shiftKey: true } as KeyboardEvent, root)).toBe(false)
  })

  it('classifies terminal commands and decline-first requests as high risk', () => {
    expect(isHighRiskPermission({ requestId: 'a', toolName: 'Bash', input: {}, allowAlwaysAllow: false })).toBe(true)
    expect(isHighRiskPermission({ requestId: 'b', toolName: 'Read', input: {}, allowAlwaysAllow: false, defaultToNo: true })).toBe(true)
    expect(isHighRiskPermission({ requestId: 'c', toolName: 'Read', input: {}, allowAlwaysAllow: false })).toBe(false)
  })

  it('cancels native button activation while leaving text entry editable', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    const button = document.createElement('button')
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    root.append(button, input, textarea)
    const clear = setDecisionKeyboardPolicy(root, 'permission:native', true)
    vi.advanceTimersByTime(501)

    for (const key of ['Enter', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      button.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
    const typing = new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true })
    input.dispatchEvent(typing)
    expect(typing.defaultPrevented).toBe(false)
    for (const key of [' ', '1']) {
      const typing = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      textarea.dispatchEvent(typing)
      expect(typing.defaultPrevented).toBe(false)
    }

    clear()
    const after = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    button.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })

  it('leaves a text field for the prompt container instead of <body>', () => {
    const prompt = document.body.appendChild(document.createElement('div'))
    prompt.tabIndex = -1
    prompt.setAttribute('data-decision-focus', '')
    const field = prompt.appendChild(document.createElement('textarea'))
    field.focus()
    leaveDecisionField(field)
    expect(document.activeElement).toBe(prompt)
    prompt.remove()
  })
})
