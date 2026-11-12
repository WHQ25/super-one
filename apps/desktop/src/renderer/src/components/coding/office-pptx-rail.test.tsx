/** @vitest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OfficePptxThumbnailRail } from './office-pptx-rail'
import { PPTX_THUMB_WIDTH, pptxThumbCanvasHeight, pptxThumbRowHeight } from './office-pptx-thumbs'

const renderer = {
  async renderThumbnail(index: number, target: HTMLElement) {
    target.replaceChildren(document.createTextNode(String(index + 1)))
    return () => target.replaceChildren()
  },
}

describe('OfficePptxThumbnailRail', () => {
  it('lists every slide of a short deck, starting at slide 1', async () => {
    render(
      <div className="flex h-80">
        <OfficePptxThumbnailRail count={10} active={1} aspect={16 / 9} renderer={renderer} onSelect={() => {}} />
      </div>,
    )

    for (let number = 1; number <= 10; number += 1) {
      expect(screen.getByRole('button', { name: `Go to Slide ${number}` })).toBeInTheDocument()
    }

    const rail = screen.getByRole('navigation', { name: 'Slide thumbnails' })
    const sizer = rail.firstElementChild as HTMLElement
    expect(sizer.style.height).toBe(`${10 * pptxThumbRowHeight(16 / 9)}px`)

    const first = screen.getByRole('button', { name: 'Go to Slide 1' })
    const canvas = first.querySelector('span[style]') as HTMLElement
    expect(canvas.style.width).toBe(`${PPTX_THUMB_WIDTH}px`)
    expect(canvas.style.height).toBe(`${pptxThumbCanvasHeight(16 / 9)}px`)
    expect(first.compareDocumentPosition(screen.getByRole('button', { name: 'Go to Slide 10' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await waitFor(() => expect(canvas.textContent).toBe('1'))
  })
})
