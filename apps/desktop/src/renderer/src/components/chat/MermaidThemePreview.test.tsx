/** @vitest-environment jsdom */

import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MermaidThemePreview } from './MermaidThemePreview'

const renderMock = vi.fn()

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: (...args: unknown[]) => renderMock(...args),
  },
}))

describe('MermaidThemePreview', () => {
  beforeEach(() => {
    renderMock.mockReset()
  })

  it('keeps the previous svg painted while a theme switch re-renders (no layout collapse)', async () => {
    const resolvers: Array<(v: { svg: string }) => void> = []
    renderMock.mockImplementation(
      () => new Promise<{ svg: string }>((resolve) => {
        resolvers.push(resolve)
      }),
    )

    const { rerender, container } = render(
      <MermaidThemePreview themeId="default" scheme="light" />,
    )

    // First paint: loading overlay only (no svg yet).
    expect(container.querySelector('.animate-spin')).toBeTruthy()
    expect(container.querySelector('.h-40')).toBeTruthy()

    await waitFor(() => expect(resolvers.length).toBe(1))
    await act(async () => {
      resolvers[0]!({ svg: '<svg data-theme="default"></svg>' })
    })
    await waitFor(() => {
      expect(container.innerHTML).toContain('data-theme="default"')
    })
    // Settled: no spinner.
    expect(container.querySelector('.animate-spin')).toBeNull()

    // Switch theme — previous art must stay until the next render resolves.
    rerender(<MermaidThemePreview themeId="forest" scheme="light" />)

    await waitFor(() => expect(resolvers.length).toBe(2))
    expect(container.querySelector('.animate-spin')).toBeTruthy()
    // Stale theme art still in the DOM (prevents confirm-dialog reflow).
    expect(container.innerHTML).toContain('data-theme="default"')
    expect(screen.queryByText(/error/i)).toBeNull()

    await act(async () => {
      resolvers[1]!({ svg: '<svg data-theme="forest"></svg>' })
    })
    await waitFor(() => {
      expect(container.innerHTML).toContain('data-theme="forest"')
    })
    expect(container.innerHTML).not.toContain('data-theme="default"')
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('uses a fixed-height preview surface so theme swaps cannot resize the dialog', () => {
    renderMock.mockResolvedValue({ svg: '<svg></svg>' })
    const { container } = render(<MermaidThemePreview themeId="dark" scheme="dark" />)
    const surface = container.querySelector('.h-40')
    expect(surface).toBeTruthy()
    expect(surface).toHaveClass('relative')
  })
})
