/** @vitest-environment jsdom */

import { render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VirtualTranscriptBlock } from './VirtualTranscriptBlock'
import { VirtualTranscriptList, type VirtualTranscriptHandle } from './VirtualTranscriptList'

afterEach(() => vi.restoreAllMocks())

function Host({ count, settled = false }: { count: number; settled?: boolean }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<VirtualTranscriptHandle>(null)
  const items = Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    content: settled
      ? <VirtualTranscriptBlock cacheKey="reply"><p>settled reply</p></VirtualTranscriptBlock>
      : <span>row {index}</span>,
  }))
  return (
    <div ref={viewportRef}>
      <VirtualTranscriptList items={items} viewportRef={viewportRef} apiRef={apiRef} />
    </div>
  )
}

describe('VirtualTranscriptList scroll anchoring', () => {
  it('turns overflow anchoring off for a short list', () => {
    const { container } = render(<Host count={1} />)
    const viewport = container.firstElementChild as HTMLElement
    const list = container.querySelector('[data-virtual-transcript]') as HTMLElement
    expect(viewport.style.getPropertyValue('overflow-anchor')).toBe('none')
    expect(list.style.getPropertyValue('overflow-anchor')).toBe('none')
  })

  it('shows a block remounted beside the viewport in the same commit', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 640, 100))
    const { rerender, queryByText } = render(<Host count={1} />)
    // The observer reports a frame later; until then the placeholder would paint empty.
    rerender(<Host count={1} settled />)
    expect(queryByText('settled reply')).not.toBeNull()
  })
})
