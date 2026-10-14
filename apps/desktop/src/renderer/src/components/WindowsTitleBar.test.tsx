/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useAppStore } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { LayoutToggle } from './coding/LayoutToggle'
import { ActivityHeaderPrefix } from './activity/ActivityHeaderPrefix'
import { WindowsTitleBar } from './WindowsTitleBar'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/useWindowChromeSync', () => ({ useWindowChromeSync: () => {} }))
vi.hoisted(() => { Object.assign(window.app, { platform: 'win32' }) })

const originalApp = window.app

function setPlatform(platform: string): void {
  window.app = new Proxy(originalApp, {
    get: (target, key, receiver) => key === 'platform' ? platform
      : key === 'getFullscreen' ? async () => false
      : Reflect.get(target, key, receiver),
  })
}

describe('Windows title bar layout controls', () => {
  beforeEach(() => {
    setPlatform('win32')
    useAppStore.setState({ showSidebar: true })
    useActivityPanelStore.setState({ showPanel: true, side: 'left', maximized: false })
  })

  afterEach(() => {
    cleanup()
    window.app = originalApp
  })

  it('hosts both controls only in the title bar, including a left activity header', () => {
    const { container } = render(<>
      <WindowsTitleBar showLayoutControls />
      <LayoutToggle />
      <ActivityHeaderPrefix />
    </>)
    const titleBar = container.querySelector('[data-windows-titlebar]') as HTMLElement
    expect(titleBar).not.toBeNull()
    expect(within(titleBar).getAllByRole('button')).toHaveLength(2)
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('keeps the title bar controls connected to sidebar and panel layout state', () => {
    render(<WindowsTitleBar showLayoutControls />)
    const sidebar = screen.getByRole('button', { name: 'tooltips.toggleSidebar' })
    expect(sidebar).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(sidebar)
    expect(useAppStore.getState().showSidebar).toBe(false)
    expect(sidebar).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(sidebar)
    expect(useAppStore.getState().showSidebar).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'tooltips.moveChatLeft' }))
    expect(useActivityPanelStore.getState().side).toBe('right')
    fireEvent.click(screen.getByRole('button', { name: 'tooltips.moveChatRight' }))
    expect(useActivityPanelStore.getState().side).toBe('left')
  })

  it.each([
    { showPanel: true, maximized: true },
    { showPanel: false, maximized: false },
  ])('hides the side switch when it has no docked panel: %j', (state) => {
    render(<WindowsTitleBar showLayoutControls />)
    act(() => useActivityPanelStore.setState(state))
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'tooltips.toggleSidebar' })).toBeVisible()
  })

  it('keeps settings and startup title bars free of workspace controls', () => {
    render(<WindowsTitleBar />)
    expect(screen.getByAltText('SuperOne')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it.each(['darwin', 'linux'])('retains content controls without a Windows title bar on %s', (platform) => {
    setPlatform(platform)
    const { container } = render(<><WindowsTitleBar showLayoutControls /><LayoutToggle /></>)
    expect(container.querySelector('[data-windows-titlebar]')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })
})
