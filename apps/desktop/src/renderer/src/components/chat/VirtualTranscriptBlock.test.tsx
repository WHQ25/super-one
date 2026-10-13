/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TranscriptStateProvider, useTranscriptState } from '@superone/ui/lib/transcript-state'
import { VirtualTranscriptBlock } from './VirtualTranscriptBlock'
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
})
