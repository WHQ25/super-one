/** @vitest-environment jsdom */

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownImage } from './markdown-image'

describe('markdown image inside a link', () => {
  it('opens the lightbox when the image stands on its own', () => {
    render(<MarkdownImage src="https://example.com/a.png" alt="a shot" />)
    fireEvent.click(screen.getByRole('button', { name: 'a shot' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('leaves the click to the anchor when the image is a link', () => {
    render(
      <a href="https://example.com">
        <MarkdownImage src="https://example.com/a.png" alt="a shot" />
      </a>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'a shot' }))
    // The anchor already prompts before leaving the app; stacking the image
    // viewer on top of that prompt is the bug this guards.
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
