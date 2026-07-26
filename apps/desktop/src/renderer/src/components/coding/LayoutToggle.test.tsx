/** @vitest-environment jsdom */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { useAppStore } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { LayoutToggle } from './LayoutToggle'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/lib/layout-actions', () => ({
  toggleSidebar: vi.fn(),
  toggleActivitySide: vi.fn(),
}))

describe('LayoutToggle', () => {
  beforeEach(() => {
    useAppStore.setState({ showSidebar: true })
    useActivityPanelStore.setState({ showPanel: true, side: 'left', maximized: false })
  })

  it('shows the move-chat control when the activity panel is docked', () => {
    const { container } = render(<LayoutToggle />)
    const buttons = container.querySelectorAll('button')
    expect(buttons).toHaveLength(2)
  })

  it('hides the move-chat control when the activity panel is maximized', () => {
    act(() => useActivityPanelStore.setState({ maximized: true }))
    const { container } = render(<LayoutToggle />)
    const buttons = container.querySelectorAll('button')
    // Only the sidebar toggle remains — chat is floating, side swap is N/A.
    expect(buttons).toHaveLength(1)
  })

  it('hides the move-chat control when the activity panel is closed', () => {
    act(() => useActivityPanelStore.setState({ showPanel: false }))
    const { container } = render(<LayoutToggle />)
    expect(container.querySelectorAll('button')).toHaveLength(1)
  })
})
