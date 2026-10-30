/** @vitest-environment jsdom */

import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ScrollArea } from './scroll-area'

describe('ScrollArea edge fade', () => {
  it('leaves the viewport alone unless a fade is requested', () => {
    const { container } = render(<ScrollArea><div>row</div></ScrollArea>)
    expect(container.querySelector('[data-slot="scroll-area-viewport"]')).not.toHaveClass('scroll-edge-fade-y')
  })

  it('fades the viewport on the block axis when asked', () => {
    const { container } = render(<ScrollArea edgeFade><div>row</div></ScrollArea>)
    expect(container.querySelector('[data-slot="scroll-area-viewport"]')).toHaveClass('scroll-edge-fade-y')
  })

  it('reports scrolling from the viewport', () => {
    const onScroll = vi.fn()
    const { container } = render(<ScrollArea onScroll={onScroll}><div>row</div></ScrollArea>)
    fireEvent.scroll(container.querySelector('[data-slot="scroll-area-viewport"]')!)
    expect(onScroll).toHaveBeenCalledOnce()
  })
})
