/** @vitest-environment jsdom */

import { type MouseEvent as ReactMouseEvent } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useResizeHandle } from './useResizeHandle'

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
})

describe('useResizeHandle', () => {
  it('syncs dependent layouts for drag updates and the final pointer position', () => {
    const outer = document.createElement('div')
    const inner = document.createElement('div')
    document.body.append(outer, inner)
    const setWidth = vi.fn()
    const onResize = vi.fn()
    const { result } = renderHook(() => useResizeHandle({
      getWidth: () => 400,
      setWidth,
      minWidth: 200,
      getMaxWidth: () => 800,
      direction: 'ltr',
      outerRef: { current: outer },
      innerRef: { current: inner },
      onResize,
    }))

    act(() => result.current({ clientX: 100, preventDefault: vi.fn() } as unknown as ReactMouseEvent))
    act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150 })))

    expect(outer.style.width).toBe('450px')
    expect(inner.style.width).toBe('450px')
    expect(onResize).toHaveBeenLastCalledWith(450)

    act(() => document.dispatchEvent(new MouseEvent('mouseup', { clientX: 175 })))

    expect(outer.style.width).toBe('475px')
    expect(inner.style.width).toBe('475px')
    expect(onResize).toHaveBeenLastCalledWith(475)
    expect(setWidth).toHaveBeenCalledWith(475)
  })
})
