/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLinkPreviewHover } from './use-link-preview-hover'

const href = 'https://example.com/docs'

function createLink(rects = [new DOMRect(450, 90, 250, 30)]) {
  const element = document.createElement('a')
  element.getClientRects = () => Object.assign([...rects], { item: (index: number) => rects[index] ?? null })
  element.getBoundingClientRect = () => rects[0]!
  return element
}

describe('link preview hover', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('anchors vertically to the text line regardless of the pointer height within that line', () => {
    const element = createLink()
    const { result } = renderHook(useLinkPreviewHover)
    act(() => result.current.hover(href, element, { clientX: 500, clientY: 92 }))
    act(() => vi.advanceTimersByTime(200))
    const first = result.current.anchor.current.getBoundingClientRect()
    expect(first).toMatchObject({ x: 500, y: 90, width: 0, height: 30, bottom: 120 })
    act(() => result.current.close())
    act(() => result.current.hover(href, element, { clientX: 500, clientY: 118 }))
    act(() => vi.advanceTimersByTime(200))
    expect(result.current.anchor.current.getBoundingClientRect()).toEqual(first)
  })

  it('keeps the initially hovered line of a wrapped link when moving to another line', () => {
    const element = createLink([new DOMRect(450, 90, 200, 20), new DOMRect(40, 120, 300, 20)])
    element.getBoundingClientRect = () => new DOMRect(40, 90, 610, 50)
    const { result } = renderHook(useLinkPreviewHover)
    act(() => result.current.hover(href, element, { clientX: 150, clientY: 125 }))
    act(() => vi.advanceTimersByTime(200))
    expect(result.current.anchor.current.getBoundingClientRect()).toMatchObject({ x: 150, y: 120, height: 20, bottom: 140 })
    act(() => result.current.hover(href, element, { clientX: 500, clientY: 100 }))
    expect(result.current.anchor.current.getBoundingClientRect()).toMatchObject({ x: 150, y: 120, height: 20, bottom: 140 })
  })

  it('opens at the initial hover position without restarting the delay on movement', () => {
    const element = createLink()
    const { result } = renderHook(useLinkPreviewHover)
    act(() => result.current.hover(href, element, { clientX: 500, clientY: 100 }))
    act(() => vi.advanceTimersByTime(100))
    act(() => result.current.hover(href, element, { clientX: 600, clientY: 110 }))
    expect(result.current.open).toBe(false)
    act(() => vi.advanceTimersByTime(100))
    expect(result.current.open).toBe(true)
    expect(result.current.anchor.current.getBoundingClientRect()).toMatchObject({ x: 500, y: 90, width: 0, height: 30 })
  })

  it('keeps an open preview fixed while the pointer moves within the same link', () => {
    const element = createLink()
    const { result } = renderHook(useLinkPreviewHover)
    act(() => result.current.hover(href, element, { clientX: 500, clientY: 100 }))
    act(() => vi.advanceTimersByTime(200))
    const anchor = result.current.anchor
    act(() => result.current.hover(href, element, { clientX: 650, clientY: 120 }))
    expect(result.current.anchor.current.getBoundingClientRect()).toMatchObject({ x: 500, y: 90 })
    expect(result.current.anchor).toBe(anchor)
  })

  it('anchors a different link occurrence at its own initial hover position', () => {
    const { result } = renderHook(useLinkPreviewHover)
    act(() => result.current.hover(href, createLink(), { clientX: 500, clientY: 100 }))
    act(() => vi.advanceTimersByTime(200))
    const nextElement = createLink([new DOMRect(650, 180, 150, 30)])
    act(() => result.current.hover(href, nextElement, { clientX: 700, clientY: 200 }))
    expect(result.current.open).toBe(true)
    expect(result.current.anchor.current.contextElement).toBe(nextElement)
    expect(result.current.anchor.current.getBoundingClientRect()).toMatchObject({ x: 700, y: 180 })
  })

  it('starts at a new position when the same link is hovered after closing', () => {
    const element = createLink()
    const { result } = renderHook(useLinkPreviewHover)
    act(() => result.current.hover(href, element, { clientX: 500, clientY: 100 }))
    act(() => vi.advanceTimersByTime(200))
    act(() => result.current.scheduleClose())
    act(() => vi.advanceTimersByTime(300))
    act(() => result.current.hover(href, element, { clientX: 650, clientY: 120 }))
    expect(result.current.open).toBe(false)
    act(() => vi.advanceTimersByTime(200))
    expect(result.current.open).toBe(true)
    expect(result.current.anchor.current.getBoundingClientRect()).toMatchObject({ x: 650, y: 90 })
  })

  it('starts a fresh delay and anchor when re-entering a link before its cancelled preview closes', () => {
    const element = createLink()
    const { result } = renderHook(useLinkPreviewHover)
    act(() => result.current.hover(href, element, { clientX: 500, clientY: 100 }))
    act(() => vi.advanceTimersByTime(100))
    act(() => result.current.scheduleClose())
    act(() => vi.advanceTimersByTime(50))
    act(() => result.current.hover(href, element, { clientX: 650, clientY: 120 }))
    act(() => vi.advanceTimersByTime(199))
    expect(result.current.open).toBe(false)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.open).toBe(true)
    expect(result.current.anchor.current.getBoundingClientRect()).toMatchObject({ x: 650, y: 90 })
  })

  it('keeps the preview and its anchor when the pointer crosses into the card', () => {
    const { result } = renderHook(useLinkPreviewHover)
    act(() => result.current.hover(href, createLink(), { clientX: 500, clientY: 100 }))
    act(() => vi.advanceTimersByTime(200))
    act(() => result.current.scheduleClose())
    act(() => vi.advanceTimersByTime(50))
    act(() => result.current.keepOpen())
    act(() => vi.advanceTimersByTime(350))
    expect(result.current.open).toBe(true)
    expect(result.current.anchor.current.getBoundingClientRect()).toMatchObject({ x: 500, y: 90 })
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
