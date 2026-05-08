/** @vitest-environment jsdom */

import { renderHook, act } from '@testing-library/react'
import { useRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useCtrlTabSwitcher } from './useCtrlTabSwitcher'

function dispatchKeyDown(key: string, modifiers: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
  window.dispatchEvent(event)
  return event
}

function dispatchKeyUp(key: string) {
  const event = new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true })
  window.dispatchEvent(event)
  return event
}

describe('useCtrlTabSwitcher', () => {
  let scopeEl: HTMLElement
  let outsideEl: HTMLElement

  beforeEach(() => {
    scopeEl = document.createElement('div')
    document.body.appendChild(scopeEl)
    const inner = document.createElement('button')
    scopeEl.appendChild(inner)
    outsideEl = document.createElement('button')
    document.body.appendChild(outsideEl)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  function mount(
    itemsCountAndCurrent: () => { count: number; currentIndex: number } | null,
    onCommit: (i: number) => void,
    options: { claimWhenUnfocused?: boolean } = {},
  ) {
    return renderHook(() => {
      const ref = useRef<HTMLElement | null>(scopeEl)
      return useCtrlTabSwitcher({ scopeRef: ref, getItems: itemsCountAndCurrent, onCommit, claimWhenUnfocused: options.claimWhenUnfocused })
    })
  }

  it('opens popup with selectedIndex pointing to the next session when Ctrl+Tab fires inside scope', () => {
    const onCommit = vi.fn()
    const { result } = mount(() => ({ count: 3, currentIndex: 0 }), onCommit)
    ;(scopeEl.firstChild as HTMLButtonElement).focus()

    act(() => { dispatchKeyDown('Tab', { ctrlKey: true }) })

    expect(result.current.isOpen).toBe(true)
    expect(result.current.selectedIndex).toBe(1)
    expect(result.current.itemCount).toBe(3)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('does not open when focus is outside the scope', () => {
    const onCommit = vi.fn()
    const { result } = mount(() => ({ count: 3, currentIndex: 0 }), onCommit)
    outsideEl.focus()

    act(() => { dispatchKeyDown('Tab', { ctrlKey: true }) })

    expect(result.current.isOpen).toBe(false)
  })

  it('preventDefault and stays closed when the only item is the current session', () => {
    const onCommit = vi.fn()
    const { result } = mount(() => ({ count: 1, currentIndex: 0 }), onCommit)
    ;(scopeEl.firstChild as HTMLButtonElement).focus()

    const ev = dispatchKeyDown('Tab', { ctrlKey: true })

    expect(result.current.isOpen).toBe(false)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('opens with selectedIndex 0 when current is not in the active list (currentIndex = -1)', () => {
    const onCommit = vi.fn()
    const { result } = mount(() => ({ count: 2, currentIndex: -1 }), onCommit)
    ;(scopeEl.firstChild as HTMLButtonElement).focus()

    act(() => { dispatchKeyDown('Tab', { ctrlKey: true }) })

    expect(result.current.isOpen).toBe(true)
    expect(result.current.selectedIndex).toBe(0)
  })

  it('opens single-item popup when the only active session is not the current one', () => {
    const onCommit = vi.fn()
    const { result } = mount(() => ({ count: 1, currentIndex: -1 }), onCommit)
    ;(scopeEl.firstChild as HTMLButtonElement).focus()

    act(() => { dispatchKeyDown('Tab', { ctrlKey: true }) })

    expect(result.current.isOpen).toBe(true)
    expect(result.current.selectedIndex).toBe(0)
  })

  it('claimWhenUnfocused: opens when activeElement is the body', () => {
    const onCommit = vi.fn()
    const { result } = mount(() => ({ count: 2, currentIndex: 0 }), onCommit, { claimWhenUnfocused: true })
    ;(document.activeElement as HTMLElement | null)?.blur?.()

    act(() => { dispatchKeyDown('Tab', { ctrlKey: true }) })

    expect(result.current.isOpen).toBe(true)
    expect(result.current.selectedIndex).toBe(1)
  })

  it('claimWhenUnfocused: still rejects when an unrelated element is focused', () => {
    const onCommit = vi.fn()
    const { result } = mount(() => ({ count: 2, currentIndex: 0 }), onCommit, { claimWhenUnfocused: true })
    outsideEl.focus()

    act(() => { dispatchKeyDown('Tab', { ctrlKey: true }) })

    expect(result.current.isOpen).toBe(false)
  })

  it('advances selectedIndex on subsequent Ctrl+Tab while popup is open and wraps around', () => {
    const onCommit = vi.fn()
    const { result } = mount(() => ({ count: 3, currentIndex: 0 }), onCommit)
    ;(scopeEl.firstChild as HTMLButtonElement).focus()

    act(() => { dispatchKeyDown('Tab', { ctrlKey: true }) })
    expect(result.current.selectedIndex).toBe(1)

    act(() => { dispatchKeyDown('Tab', { ctrlKey: true }) })
    expect(result.current.selectedIndex).toBe(2)

    act(() => { dispatchKeyDown('Tab', { ctrlKey: true }) })
    expect(result.current.selectedIndex).toBe(0)

    act(() => { dispatchKeyDown('Tab', { ctrlKey: true }) })
    expect(result.current.selectedIndex).toBe(1)
  })

  it('commits the selectedIndex when Control is released', () => {
    const onCommit = vi.fn()
    const { result } = mount(() => ({ count: 3, currentIndex: 0 }), onCommit)
    ;(scopeEl.firstChild as HTMLButtonElement).focus()

    act(() => { dispatchKeyDown('Tab', { ctrlKey: true }) })
    act(() => { dispatchKeyDown('Tab', { ctrlKey: true }) })
    act(() => { dispatchKeyUp('Control') })

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(2)
    expect(result.current.isOpen).toBe(false)
  })

  it('does not commit when Ctrl release lands on the current session', () => {
    const onCommit = vi.fn()
    const { result } = mount(() => ({ count: 2, currentIndex: 0 }), onCommit)
    ;(scopeEl.firstChild as HTMLButtonElement).focus()

    act(() => { dispatchKeyDown('Tab', { ctrlKey: true }) })
    act(() => { dispatchKeyDown('Tab', { ctrlKey: true }) })
    act(() => { dispatchKeyUp('Control') })

    expect(onCommit).not.toHaveBeenCalled()
    expect(result.current.isOpen).toBe(false)
  })

  it('Esc cancels without committing', () => {
    const onCommit = vi.fn()
    const { result } = mount(() => ({ count: 3, currentIndex: 0 }), onCommit)
    ;(scopeEl.firstChild as HTMLButtonElement).focus()

    act(() => { dispatchKeyDown('Tab', { ctrlKey: true }) })
    act(() => { dispatchKeyDown('Escape') })

    expect(result.current.isOpen).toBe(false)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('window blur cancels without committing', () => {
    const onCommit = vi.fn()
    const { result } = mount(() => ({ count: 3, currentIndex: 0 }), onCommit)
    ;(scopeEl.firstChild as HTMLButtonElement).focus()

    act(() => { dispatchKeyDown('Tab', { ctrlKey: true }) })
    act(() => { window.dispatchEvent(new Event('blur')) })

    expect(result.current.isOpen).toBe(false)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('ignores Ctrl+Shift+Tab so plan-mode shortcut is not stolen', () => {
    const onCommit = vi.fn()
    const { result } = mount(() => ({ count: 3, currentIndex: 0 }), onCommit)
    ;(scopeEl.firstChild as HTMLButtonElement).focus()

    const ev = dispatchKeyDown('Tab', { ctrlKey: true, shiftKey: true })

    expect(result.current.isOpen).toBe(false)
    expect(ev.defaultPrevented).toBe(false)
  })

  it('does not attach listeners when enabled is false', () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() => {
      const ref = useRef<HTMLElement | null>(scopeEl)
      return useCtrlTabSwitcher({ scopeRef: ref, getItems: () => ({ count: 3, currentIndex: 0 }), onCommit, enabled: false })
    })
    ;(scopeEl.firstChild as HTMLButtonElement).focus()

    act(() => { dispatchKeyDown('Tab', { ctrlKey: true }) })

    expect(result.current.isOpen).toBe(false)
  })
})
