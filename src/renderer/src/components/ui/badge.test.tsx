/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from './badge'

describe('Badge', () => {
  it('renders text and default variant attributes', () => {
    render(<Badge>Stable</Badge>)

    const badge = screen.getByText('Stable')
    expect(badge).not.toBeNull()
    expect(badge.getAttribute('data-slot')).toBe('badge')
    expect(badge.getAttribute('data-variant')).toBe('default')
    expect(badge.className).toContain('inline-flex')
  })

  it('renders as child element when asChild is true', () => {
    render(
      <Badge asChild>
        <a href="/docs">Docs</a>
      </Badge>
    )

    const link = screen.getByRole('link', { name: 'Docs' })
    expect(link).not.toBeNull()
    expect(link.getAttribute('href')).toBe('/docs')
    expect(link.getAttribute('data-slot')).toBe('badge')
  })
})
