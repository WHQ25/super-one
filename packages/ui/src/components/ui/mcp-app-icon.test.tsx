/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { McpAppIcon } from './mcp-app-icon'

const svg = (body: string) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`)

afterEach(cleanup)
describe('McpAppIcon', () => {
  it('paints a one-colour SVG in the text colour instead of its hard-coded colour', () => {
    render(<McpAppIcon src={svg('<path stroke="#27272a" d="M2 2h12v12H2z"/>')} alt="CAD" className="text-muted-foreground" fallback="glyph" />)
    const icon = screen.getByRole('img', { name: 'CAD' })
    expect(icon.tagName).toBe('SPAN')
    expect(icon.className).toContain('bg-current')
  })

  it('shows a multi-colour icon as the image it is, without a referrer', () => {
    const src = svg('<rect width="16" height="16" fill="#2563eb"/><path stroke="#fff" d="M4 8h8"/>')
    render(<McpAppIcon src={src} alt="Tracker" fallback="glyph" />)
    const icon = screen.getByRole('img', { name: 'Tracker' })
    expect(icon.tagName).toBe('IMG')
    expect(icon.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('falls back when there is no icon or it fails to load', () => {
    const { rerender } = render(<McpAppIcon fallback="glyph" />)
    expect(screen.getByText('glyph')).toBeTruthy()
    rerender(<McpAppIcon src="https://example.com/broken.png" alt="Broken" fallback="glyph" />)
    fireEvent.error(screen.getByRole('img', { name: 'Broken' }))
    expect(screen.getByText('glyph')).toBeTruthy()
  })
})
