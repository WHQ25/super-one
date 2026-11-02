/** @vitest-environment jsdom */

import { render } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
import { VirtualTranscriptList, type VirtualTranscriptHandle } from './VirtualTranscriptList'

function Host({ count }: { count: number }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<VirtualTranscriptHandle>(null)
  const items = Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    content: <span>row {index}</span>,
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
})
