/** @vitest-environment jsdom */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, fireEvent, cleanup, act } from '@testing-library/react'
import type { IDockviewPanelHeaderProps } from 'dockview-core'
import { BrowserTab } from './ActivityTab'
import { fakeTabApi } from './activity-tab-story-api'
import { registerBrowserWebview } from '@/components/browser/browser-host-api'
import { useBrowserStore } from '@/stores/browser'

const ID = 'audio-tab'

function renderTab() {
  return render(
    <BrowserTab {...({ api: fakeTabApi('Radio', true), params: { browserId: ID } } as unknown as IDockviewPanelHeaderProps<{ browserId: string }>)} />,
  )
}

let setAudioMuted: ReturnType<typeof vi.fn>
let unregister: () => void

beforeEach(() => {
  ;(window as unknown as { app: { resolveFavicon: () => Promise<null> } }).app = { resolveFavicon: async () => null }
  setAudioMuted = vi.fn()
  unregister = registerBrowserWebview(ID, { setAudioMuted } as unknown as Electron.WebviewTag)
  useBrowserStore.setState({ tabs: {} })
  useBrowserStore.getState().ensure(ID, 'https://radio.example.com')
})

afterEach(() => {
  cleanup()
  unregister()
})

describe('browser tab audio toggle', () => {
  it('shows nothing while the page is silent and unmuted', () => {
    const { queryByRole } = renderTab()
    expect(queryByRole('button', { pressed: false })).toBeNull()
    expect(queryByRole('button', { pressed: true })).toBeNull()
  })

  it('mutes and unmutes the guest on successive clicks', () => {
    act(() => useBrowserStore.getState().patch(ID, { audible: true }))
    const { getByRole } = renderTab()

    fireEvent.click(getByRole('button', { pressed: false }))
    expect(setAudioMuted).toHaveBeenLastCalledWith(true)
    expect(useBrowserStore.getState().tabs[ID].muted).toBe(true)

    fireEvent.click(getByRole('button', { pressed: true }))
    expect(setAudioMuted).toHaveBeenLastCalledWith(false)
    expect(useBrowserStore.getState().tabs[ID].muted).toBe(false)
  })

  it('keeps the muted icon after the page goes quiet so it can be unmuted', () => {
    act(() => useBrowserStore.getState().patch(ID, { audible: true, muted: true }))
    const { getByRole } = renderTab()
    act(() => useBrowserStore.getState().patch(ID, { audible: false }))
    expect(getByRole('button', { pressed: true })).toBeTruthy()
  })

  it('leaves the stored state alone when the guest cannot be muted', () => {
    setAudioMuted.mockImplementation(() => { throw new Error('not attached') })
    act(() => useBrowserStore.getState().patch(ID, { audible: true }))
    const { getByRole } = renderTab()
    fireEvent.click(getByRole('button', { pressed: false }))
    expect(useBrowserStore.getState().tabs[ID].muted).toBe(false)
  })
})
