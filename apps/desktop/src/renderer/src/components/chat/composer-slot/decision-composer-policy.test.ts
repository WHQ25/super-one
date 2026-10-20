/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  leaveDecisionField,
  setDecisionKeyboardPolicy,
  shouldSuppressDecisionShortcut,
} from './decision-composer-policy'

afterEach(() => vi.useRealTimers())

function key(name: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key: name, ...modifiers } as KeyboardEvent
}

describe('decision composer keyboard policy', () => {
  it('holds shortcut keys for a short window when the prompt does not rise in the slot', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    setDecisionKeyboardPolicy(root, 'plan:p1')

    expect(shouldSuppressDecisionShortcut(key('Enter'), root)).toBe(true)
    expect(shouldSuppressDecisionShortcut(key('2'), root)).toBe(true)
    expect(shouldSuppressDecisionShortcut(key('Escape'), root)).toBe(false)

    vi.advanceTimersByTime(501)
    expect(shouldSuppressDecisionShortcut(key('Enter'), root)).toBe(false)
  })

  it('holds shortcuts only while the approval card is rising', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    const entrance = document.createElement('div')
    entrance.setAttribute('data-phase', 'entering')
    setDecisionKeyboardPolicy(root, 'permission:p2', entrance)

    expect(shouldSuppressDecisionShortcut(key('Enter'), root)).toBe(true)
    expect(shouldSuppressDecisionShortcut(key('1'), root)).toBe(true)
    expect(shouldSuppressDecisionShortcut(key('Tab', { shiftKey: true }), root)).toBe(false)

    const child = entrance.appendChild(document.createElement('span'))
    child.dispatchEvent(new Event('animationend', { bubbles: true }))
    expect(shouldSuppressDecisionShortcut(key('Enter'), root)).toBe(true)

    entrance.dispatchEvent(new Event('animationend'))
    expect(shouldSuppressDecisionShortcut(key('Enter'), root)).toBe(false)
  })

  it('releases a rise that never ends once the animation deadline passes', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    const entrance = document.createElement('div')
    entrance.setAttribute('data-phase', 'entering')
    setDecisionKeyboardPolicy(root, 'permission:stuck', entrance)

    vi.advanceTimersByTime(599)
    expect(shouldSuppressDecisionShortcut(key('Enter'), root)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(shouldSuppressDecisionShortcut(key('Enter'), root)).toBe(false)
  })

  it('does not hold shortcuts when the card is already at rest', () => {
    const steadyRoot = document.createElement('div')
    const steady = document.createElement('div')
    steady.setAttribute('data-phase', 'steady')
    setDecisionKeyboardPolicy(steadyRoot, 'permission:rest', steady)
    expect(shouldSuppressDecisionShortcut(key('Enter'), steadyRoot)).toBe(false)

    const bareRoot = document.createElement('div')
    setDecisionKeyboardPolicy(bareRoot, 'permission:none', null)
    expect(shouldSuppressDecisionShortcut(key('Enter'), bareRoot)).toBe(false)
  })

  it('does not change Shift+Tab navigation', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    setDecisionKeyboardPolicy(root, 'permission:p3')

    expect(shouldSuppressDecisionShortcut(key('Tab', { shiftKey: true }), root)).toBe(false)
  })

  it('cancels native button activation while leaving text entry editable', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    const button = document.createElement('button')
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    root.append(button, input, textarea)
    const clear = setDecisionKeyboardPolicy(root, 'permission:native')

    for (const keyName of ['Enter', ' ']) {
      const event = new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true })
      button.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
    const typing = new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true })
    input.dispatchEvent(typing)
    expect(typing.defaultPrevented).toBe(false)
    for (const keyName of [' ', '1']) {
      const typing = new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true })
      textarea.dispatchEvent(typing)
      expect(typing.defaultPrevented).toBe(false)
    }

    vi.advanceTimersByTime(501)
    const after = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    button.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
    clear()
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
