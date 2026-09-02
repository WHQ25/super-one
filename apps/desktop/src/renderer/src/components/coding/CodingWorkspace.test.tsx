/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ activeProject: '/project', activeSessionId: 'sid-1' }))

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: unknown) => unknown) => selector({
    activeProject: hoisted.activeProject,
    projectSessions: {
      [hoisted.activeProject]: { _activeSessionId: hoisted.activeSessionId },
    },
  }),
}))

vi.mock('./CodingLayout', () => ({
  CodingLayout: ({ foreground, scope, compact }: { foreground: boolean; scope?: { projectPath: string; sessionId: string }; compact?: boolean }) => (
    <div data-testid="single" data-foreground={foreground} data-session-id={scope?.sessionId} data-compact={compact} />
  ),
}))
vi.mock('@/components/mosaic/SessionMosaic', () => ({
  SessionMosaic: ({ foreground }: { foreground: boolean }) => <div data-testid="mosaic" data-foreground={foreground} />,
}))

const { CodingWorkspace } = await import('./CodingWorkspace')

describe('CodingWorkspace', () => {
  it('keeps both layouts mounted while toggling visibility', () => {
    const { container, rerender } = render(<CodingWorkspace mosaicMode="single" />)
    expect(screen.getByTestId('single')).toHaveAttribute('data-foreground', 'true')
    expect(screen.getByTestId('mosaic')).toHaveAttribute('data-foreground', 'false')
    expect(screen.getByTestId('single').parentElement).not.toHaveClass('hidden')
    expect(screen.getByTestId('mosaic').parentElement).toHaveClass('hidden')

    rerender(<CodingWorkspace mosaicMode="mosaic" />)
    expect(container.querySelectorAll('[data-testid]')).toHaveLength(2)
    expect(screen.getByTestId('single')).toHaveAttribute('data-foreground', 'false')
    expect(screen.getByTestId('mosaic')).toHaveAttribute('data-foreground', 'true')
    expect(screen.getByTestId('single').parentElement).toHaveClass('hidden')
    expect(screen.getByTestId('mosaic').parentElement).not.toHaveClass('hidden')
  })

  it('freezes the hidden single pane while mosaic focus changes', () => {
    const { rerender } = render(<CodingWorkspace mosaicMode="single" />)
    expect(screen.getByTestId('single')).toHaveAttribute('data-session-id', 'sid-1')

    rerender(<CodingWorkspace mosaicMode="mosaic" />)
    hoisted.activeSessionId = 'sid-2'
    rerender(<CodingWorkspace mosaicMode="mosaic" />)
    expect(screen.getByTestId('single')).toHaveAttribute('data-session-id', 'sid-1')

    rerender(<CodingWorkspace mosaicMode="single" />)
    expect(screen.getByTestId('single')).toHaveAttribute('data-session-id', 'sid-2')
  })

  it('shows the focused session alone when a mosaic folds into the mini shell', () => {
    hoisted.activeSessionId = 'sid-focused'
    const { rerender } = render(<CodingWorkspace mosaicMode="mosaic" />)
    expect(screen.getByTestId('mosaic').parentElement).not.toHaveClass('hidden')

    rerender(<CodingWorkspace mosaicMode="mosaic" compact />)
    expect(screen.getByTestId('mosaic').parentElement).toHaveClass('hidden')
    expect(screen.getByTestId('mosaic')).toHaveAttribute('data-foreground', 'false')
    const single = screen.getByTestId('single')
    expect(single.parentElement).not.toHaveClass('hidden')
    expect(single).toHaveAttribute('data-foreground', 'true')
    expect(single).toHaveAttribute('data-session-id', 'sid-focused')

    // Unfolding hands the grid back untouched — the mosaic tree was never rewritten.
    rerender(<CodingWorkspace mosaicMode="mosaic" />)
    expect(screen.getByTestId('mosaic').parentElement).not.toHaveClass('hidden')
  })

  it('switches to compact chrome without replacing the single session layout', () => {
    const { rerender } = render(<CodingWorkspace mosaicMode="single" />)
    const single = screen.getByTestId('single')

    rerender(<CodingWorkspace mosaicMode="single" compact />)
    expect(screen.getByTestId('single')).toBe(single)
    expect(single).toHaveAttribute('data-compact', 'true')
  })
})
