/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLinkPreviewHover } from './use-link-preview-hover'

const href = 'https://example.com/docs'

describe('link preview hover', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('opens at the latest cursor position without restarting the delay on movement', () => {
    const element = document.createElement('a')
    const { result } = renderHook(useLinkPreviewHover)
    act(() => result.current.hover(href, element, { clientX: 500, clientY: 100 }))
    act(() => vi.advanceTimersByTime(100))
    act(() => result.current.hover(href, element, { clientX: 600, clientY: 110 }))
    expect(result.current.open).toBe(false)
    act(() => vi.advanceTimersByTime(100))
    expect(result.current.open).toBe(true)
    expect(result.current.anchor.current.getBoundingClientRect()).toMatchObject({ x: 600, y: 110, width: 0, height: 0 })
    act(() => result.current.hover(href, element, { clientX: 650, clientY: 120 }))
    expect(result.current.anchor.current.getBoundingClientRect()).toMatchObject({ x: 650, y: 120 })
  })

  it('keeps the preview and its anchor when the pointer crosses into the card', () => {
    const { result } = renderHook(useLinkPreviewHover)
    act(() => result.current.hover(href, document.createElement('a'), { clientX: 500, clientY: 100 }))
    act(() => vi.advanceTimersByTime(200))
    act(() => result.current.scheduleClose())
    act(() => vi.advanceTimersByTime(50))
    act(() => result.current.keepOpen())
    act(() => vi.advanceTimersByTime(350))
    expect(result.current.open).toBe(true)
    expect(result.current.anchor.current.getBoundingClientRect()).toMatchObject({ x: 500, y: 100 })
    act(() => result.current.scheduleClose())
    act(() => vi.advanceTimersByTime(299))
    expect(result.current.open).toBe(true)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.open).toBe(false)
  })

  it('cancels a pending preview when the pointer leaves before it opens', () => {
    const { result } = renderHook(useLinkPreviewHover)
    act(() => result.current.hover(href, document.createElement('a'), { clientX: 500, clientY: 100 }))
    act(() => vi.advanceTimersByTime(100))
    act(() => result.current.scheduleClose())
    act(() => vi.advanceTimersByTime(500))
    expect(result.current.open).toBe(false)
    expect(result.current.target).toBeNull()
  })

  it('uses the link bounds for keyboard focus instead of a stale pointer position', () => {
    const element = document.createElement('a')
    element.getBoundingClientRect = () => new DOMRect(40, 50, 100, 20)
    const { result } = renderHook(useLinkPreviewHover)
    act(() => result.current.hover(href, element, { clientX: 500, clientY: 100 }))
    act(() => vi.advanceTimersByTime(200))
    act(() => result.current.close())
    act(() => result.current.hover(href, element))
    act(() => vi.advanceTimersByTime(200))
    expect(result.current.anchor.current.getBoundingClientRect()).toMatchObject({ x: 40, y: 50, width: 100, height: 20 })
  })
})
