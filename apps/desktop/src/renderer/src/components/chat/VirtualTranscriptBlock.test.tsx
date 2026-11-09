/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TranscriptStateProvider, useTranscriptState } from '@superone/ui/lib/transcript-state'
import { VirtualMarkdownBlock } from './VirtualMarkdownBlock'
import { VirtualTranscriptBlock } from './VirtualTranscriptBlock'
import { blockStaysVisible } from './virtual-block-anchor'
import { VirtualTranscriptContext } from './virtual-transcript-context'

afterEach(() => vi.unstubAllGlobals())

describe('virtual turn blocks', () => {
  it('keeps ordinary content mounted without a transcript viewport', () => {
    render(<VirtualTranscriptBlock cacheKey="height"><p>Ordinary content</p></VirtualTranscriptBlock>)
    expect(screen.getByText('Ordinary content')).toBeVisible()
  })

  it('evicts offscreen tools, restores disclosure and measures without committing every resize', () => {
    let visible: (value: boolean) => void = () => {}
    let resize: ResizeObserverCallback = () => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resize = callback }
      observe() {}
      disconnect() {}
    })
    const renders = vi.fn()
    function Tool() {
      renders()
      const [open, setOpen] = useTranscriptState('tool-open', false)
      return <button onClick={() => setOpen(value => !value)}>{open ? 'Tool output' : 'Open tool'}</button>
    }
    const { container } = render(
      <TranscriptStateProvider values={new Map()} scope="turn">
        <VirtualTranscriptContext.Provider value={{ viewportRef: { current: null }, preserveBlockAnchor: vi.fn(), observeBlock: (_node, callback) => { visible = callback; return () => {} } }}>
          <VirtualTranscriptBlock cacheKey="height" estimate={48}><Tool /></VirtualTranscriptBlock>
        </VirtualTranscriptContext.Provider>
      </TranscriptStateProvider>,
    )
    expect(screen.queryByRole('button')).toBeNull()
    act(() => visible(true))
    fireEvent.click(screen.getByText('Open tool'))
    const count = renders.mock.calls.length
    act(() => {
      resize([{ borderBoxSize: [{ blockSize: 124, inlineSize: 360 }] } as unknown as ResizeObserverEntry], {} as ResizeObserver)
      resize([{ borderBoxSize: [{ blockSize: 140, inlineSize: 320 }] } as unknown as ResizeObserverEntry], {} as ResizeObserver)
    })
    expect(renders).toHaveBeenCalledTimes(count)
    act(() => visible(false))
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.querySelector('[data-virtual-block]')).toHaveStyle({ height: '140px' })
    act(() => visible(true))
    expect(screen.getByText('Tool output')).toBeVisible()
  })

  it('retains measured placeholder height across display:none so blocks remount after fullscreen exit', () => {
    const callbacks = new Map<HTMLElement, (value: boolean) => void>()
    const resizes: ResizeObserverCallback[] = []
    vi.stubGlobal('ResizeObserver', class {
      callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) { this.callback = callback }
      observe() { resizes.push(this.callback) }
      disconnect() {}
    })
    const { container } = render(
      <TranscriptStateProvider values={new Map()} scope="turn">
        <VirtualTranscriptContext.Provider value={{
          viewportRef: { current: null },
          preserveBlockAnchor: vi.fn(),
          observeBlock: (node, callback) => { callbacks.set(node, callback); return () => callbacks.delete(node) },
        }}>
          <VirtualTranscriptBlock cacheKey="segment" estimate={48}><p>Final agent reply</p></VirtualTranscriptBlock>
          <VirtualMarkdownBlock
            content="Long markdown paragraph"
            index={0}
            isIncomplete={false}
            shouldNormalizeHtmlIndentation={false}
            shouldParseIncompleteMarkdown={false}
          />
        </VirtualTranscriptContext.Provider>
      </TranscriptStateProvider>,
    )
    act(() => {
      for (const callback of callbacks.values()) callback(true)
    })
    expect(screen.getByText('Final agent reply')).toBeVisible()
    act(() => {
      for (const resize of resizes) {
        resize([{ borderBoxSize: [{ blockSize: 92, inlineSize: 480 }], contentRect: { height: 92, width: 480 } } as unknown as ResizeObserverEntry], {} as ResizeObserver)
      }
      for (const resize of resizes) {
        resize([{ borderBoxSize: [{ blockSize: 0, inlineSize: 0 }], contentRect: { height: 0, width: 0 } } as unknown as ResizeObserverEntry], {} as ResizeObserver)
      }
      for (const callback of callbacks.values()) callback(false)
    })
    const segmentNode = container.querySelector<HTMLElement>('[data-virtual-block="segment"]')!
    const markdownNode = container.querySelector<HTMLElement>('[data-virtual-markdown-block="0"]')!
    expect(segmentNode).toHaveStyle({ height: '92px' })
    expect(markdownNode).toHaveStyle({ height: '92px' })
    const rootBounds = new DOMRect(0, 0, 640, 800)
    expect(blockStaysVisible({
      isIntersecting: true,
      boundingClientRect: new DOMRect(0, 120, 640, parseFloat(segmentNode.style.height)),
      rootBounds,
    }, false)).toBe(true)
    act(() => {
      for (const callback of callbacks.values()) callback(true)
    })
    expect(screen.getByText('Final agent reply')).toBeVisible()
  })
})
