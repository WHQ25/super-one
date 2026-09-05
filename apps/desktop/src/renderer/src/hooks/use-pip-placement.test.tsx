/** @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PipDimensions } from '@/lib/pip-layout'
import { usePipPlacement } from './use-pip-placement'

/** A 2:1 preview, so the numbers below stay readable. */
const DIMS: PipDimensions = {
  margin: 12,
  defaultWidth: 200,
  defaultHeight: 100,
  minWidth: 200,
  minHeight: 100,
  maxWidthRatio: 0.8,
  maxHeightRatio: 0.45,
  defaultMaxHeight: 360,
}
const ASPECT = 2

const WIDE = { left: 100, top: 50, width: 1000, height: 700 }
/** What the chat measures while the Activity panel is still animating open. */
const NARROW = { left: 100, top: 50, width: 300, height: 700 }
/** What a hidden chat root measures. */
const COLLAPSED = { left: 0, top: 0, width: 0, height: 0 }

let rect = WIDE

function measuresAs(next: typeof WIDE): void {
  rect = next
  act(() => { window.dispatchEvent(new Event('resize')) })
}

beforeEach(() => {
  rect = WIDE
  document.body.innerHTML = ''
  const main = document.createElement('div')
  main.setAttribute('data-main-area', '')
  const root = document.createElement('div')
  root.setAttribute('data-chat-root', '')
  root.getBoundingClientRect = () => ({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  }) as DOMRect
  main.appendChild(root)
  document.body.appendChild(main)
})

function mount(key: string | null = 'a') {
  return renderHook(
    (props: { key: string | null }) => usePipPlacement({
      key: props.key,
      active: true,
      aspect: ASPECT,
      dims: DIMS,
    }),
    { initialProps: { key } },
  )
}

describe('pip placement', () => {
  it('opens a fresh preview at the top-right of the chat', () => {
    const { result } = mount()
    expect(result.current.layout).toEqual({ left: 888, top: 62, width: 200, height: 100 })
  })

  it('re-anchors an untouched preview when the chat finishes opening', () => {
    rect = NARROW
    const { result } = mount()
    expect(result.current.layout?.left).toBe(188)

    measuresAs(WIDE)
    // The first measurement was of a chat mid-animation. Nothing has been placed by
    // hand yet, so the default belongs to the chat the user ends up looking at.
    expect(result.current.layout).toEqual({ left: 888, top: 62, width: 200, height: 100 })
  })

  it('returns a placed preview to its own position after the chat narrows and widens', () => {
    const { result } = mount()
    act(() => result.current.setLayout({ left: 800, top: 600, width: 200, height: 100 }))

    measuresAs(NARROW)
    expect(result.current.layout?.left).toBe(188)

    measuresAs(WIDE)
    expect(result.current.layout).toEqual({ left: 800, top: 600, width: 200, height: 100 })
  })

  it('ignores a collapsed boundary rather than parking the preview in its corner', () => {
    const { result } = mount()
    act(() => result.current.setLayout({ left: 800, top: 600, width: 200, height: 100 }))

    measuresAs(COLLAPSED)
    expect(result.current.layout).toEqual({ left: 800, top: 600, width: 200, height: 100 })
  })

  it('gives each preview its own position across a switch', () => {
    const { result, rerender } = mount('a')
    act(() => result.current.setLayout({ left: 200, top: 600, width: 200, height: 100 }))

    rerender({ key: 'b' })
    expect(result.current.layout).toEqual({ left: 888, top: 62, width: 200, height: 100 })

    rerender({ key: 'a' })
    expect(result.current.layout).toEqual({ left: 200, top: 600, width: 200, height: 100 })
  })

  it('drops nothing when a preview goes away and comes back', () => {
    const { result, rerender } = mount('a')
    act(() => result.current.setLayout({ left: 200, top: 600, width: 200, height: 100 }))

    rerender({ key: null })
    expect(result.current.layout).toBeNull()

    rerender({ key: 'a' })
    expect(result.current.layout).toEqual({ left: 200, top: 600, width: 200, height: 100 })
  })
})
