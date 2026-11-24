/** @vitest-environment jsdom */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { useAppStore } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { LayoutToggle, WindowLayoutControls, useLayoutControlsWidth } from './LayoutToggle'

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

describe('WindowLayoutControls', () => {
  const originalPlatform = window.app.platform

  beforeEach(() => {
    Object.assign(window.app, { platform: 'darwin' })
    useAppStore.setState({ showSidebar: true })
    useActivityPanelStore.setState({ showPanel: true, side: 'left', maximized: false, maximizedGroupId: null, chatFloating: false })
  })

  afterEach(() => {
    cleanup()
    Object.assign(window.app, { platform: originalPlatform })
  })

  it('anchors once to the window on macOS and tracks sidebar surface and fullscreen', () => {
    const { container, rerender } = render(<>
      <WindowLayoutControls scope="window" isFullscreen={false} onSidebar />
      <WindowLayoutControls scope="card" isFullscreen={false} />
    </>)
    const overlays = container.querySelectorAll('[data-window-layout-controls]')
    expect(overlays).toHaveLength(1)
    expect(overlays[0]).toHaveClass('top-[5px]', 'left-[84px]', 'h-9')
    expect(overlays[0]).toHaveAttribute('data-on-sidebar', 'true')

    rerender(<>
      <WindowLayoutControls scope="window" isFullscreen onSidebar={false} />
      <WindowLayoutControls scope="card" isFullscreen />
    </>)
    expect(overlays[0]).toHaveClass('top-0', 'left-2', 'h-9')
    expect(overlays[0]).not.toHaveAttribute('data-on-sidebar')
  })

  it('anchors once to the card on Linux and renders nothing on Windows', () => {
    Object.assign(window.app, { platform: 'linux' })
    const { container, rerender } = render(<>
      <WindowLayoutControls scope="window" />
      <WindowLayoutControls scope="card" />
    </>)
    expect(container.querySelectorAll('[data-window-layout-controls]')).toHaveLength(1)
    expect(container.querySelector('[data-window-layout-controls]')).toHaveClass('top-0', 'left-2', 'h-9')

    Object.assign(window.app, { platform: 'win32' })
    rerender(<>
      <WindowLayoutControls scope="window" />
      <WindowLayoutControls scope="card" />
    </>)
    expect(container.querySelectorAll('[data-window-layout-controls]')).toHaveLength(0)
  })

  it('reports avoidance width matching single and double control states', () => {
    function Probe() {
      return <span data-testid="w">{useLayoutControlsWidth()}</span>
    }
    const { getByTestId } = render(<Probe />)
    expect(getByTestId('w').textContent).toBe('58')

    act(() => useActivityPanelStore.setState({ maximized: true }))
    expect(getByTestId('w').textContent).toBe('32')

    act(() => useActivityPanelStore.setState({ maximized: false, showPanel: false }))
    expect(getByTestId('w').textContent).toBe('32')
  })
})
