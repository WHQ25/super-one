/** @vitest-environment jsdom */

import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/chat', () => ({
  extractSessionTitle: () => 'Session',
  useActiveSession: (selector: (state: unknown) => unknown) => selector({
    _title: 'Session',
    _activeSessionId: 'session-1',
    messages: [],
  }),
}))
vi.mock('@/components/sidebar/AnimatedSessionTitle', () => ({
  SessionTitleAnimated: () => <span>Session</span>,
  useSessionTitleByAgent: () => 'Session',
}))
vi.mock('@/hooks/useWindowChromeSync', () => ({ useWindowChromeSync: () => undefined }))
vi.mock('@/hooks/useStandaloneSessionBoot', () => ({ useStandaloneSessionBoot: () => undefined }))

const { MiniWindowHeader } = await import('./MiniWindowApp')

describe('MiniWindowHeader', () => {
  it('does not stack an opaque card layer over a liquid-glass shell', () => {
    const { container, rerender } = render(<MiniWindowHeader transparentBackground />)
    expect(container.firstElementChild).toHaveClass('bg-transparent')
    expect(container.firstElementChild).not.toHaveClass('bg-card')

    rerender(<MiniWindowHeader />)
    expect(container.firstElementChild).toHaveClass('bg-card')
  })
})
