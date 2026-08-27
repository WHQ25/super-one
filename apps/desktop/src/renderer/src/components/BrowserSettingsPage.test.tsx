/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebmcpTrustedOrigin } from '@superone/shared/agent-types'

// Radix Switch drives pointer capture, which jsdom does not implement.
Object.defineProperties(HTMLElement.prototype, {
  hasPointerCapture: { configurable: true, value: () => false },
  setPointerCapture: { configurable: true, value: () => {} },
  releasePointerCapture: { configurable: true, value: () => {} },
})

const getAppSettings = vi.fn()
const saveAppSettings = vi.fn()
const getDefaultDownloadDir = vi.fn()
const selectFolder = vi.fn()

Object.defineProperty(window, 'app', {
  configurable: true,
  value: { getAppSettings, saveAppSettings, getDefaultDownloadDir, selectFolder },
})

const { BrowserSettingsPage } = await import('./BrowserSettingsPage')

const grant = (origin: string, tools: string[]): WebmcpTrustedOrigin => ({
  origin,
  tools: Object.fromEntries(tools.map((name) => [name, `fp:${name}`])),
})

function settings(overrides: Record<string, unknown> = {}) {
  return {
    cdpEnabled: true,
    cdpCookiesEnabled: false,
    cdpMockEnabled: false,
    cdpEmulateEnabled: false,
    browserToolSurface: 'compact',
    browserDownloadDir: null,
    webmcpEnabled: true,
    webmcpTrustedOrigins: [] as WebmcpTrustedOrigin[],
    ...overrides,
  }
}

async function renderPage(overrides: Record<string, unknown> = {}) {
  getAppSettings.mockResolvedValue(settings(overrides))
  const view = render(<BrowserSettingsPage />)
  await screen.findByText('WebMCP page tools')
  return view
}

/** The WebMCP switch is the one in the same bordered card as the WebMCP heading. */
function webmcpSwitch(): HTMLElement {
  const card = screen.getByText('WebMCP page tools').closest('.rounded-lg')
  return card!.querySelector('[role="switch"]') as HTMLElement
}

beforeEach(() => {
  getAppSettings.mockReset()
  saveAppSettings.mockReset()
  getDefaultDownloadDir.mockReset()
  getDefaultDownloadDir.mockResolvedValue('/Users/dev/Downloads')
  selectFolder.mockReset()
})

describe('browser settings — WebMCP grants', () => {
  it('hides the grants panel entirely while WebMCP is off', async () => {
    await renderPage({ webmcpEnabled: false, webmcpTrustedOrigins: [grant('https://shop.example.com', ['a'])] })
    expect(screen.queryByText('Trusted sites')).toBeNull()
    expect(screen.queryByText('https://shop.example.com')).toBeNull()
  })

  it('explains the empty state instead of showing a blank list', async () => {
    await renderPage()
    expect(screen.getByText('Trusted sites')).toBeTruthy()
    expect(screen.getByText('No sites are trusted to offer page tools.')).toBeTruthy()
  })

  it('lists each trusted origin with the number of pinned tools', async () => {
    await renderPage({
      webmcpTrustedOrigins: [
        grant('https://shop.example.com', ['add_to_cart', 'checkout']),
        grant('https://docs.example.com', ['get_page_outline']),
      ],
    })
    expect(screen.getByText('https://shop.example.com')).toBeTruthy()
    expect(screen.getByText('2 tools trusted')).toBeTruthy()
    expect(screen.getByText('https://docs.example.com')).toBeTruthy()
    expect(screen.getByText('1 tools trusted')).toBeTruthy()
  })

  it('revokes one origin and leaves the others trusted', async () => {
    const kept = grant('https://docs.example.com', ['get_page_outline'])
    await renderPage({ webmcpTrustedOrigins: [grant('https://shop.example.com', ['add_to_cart']), kept] })
    saveAppSettings.mockResolvedValue(settings({ webmcpTrustedOrigins: [kept] }))

    fireEvent.click(screen.getAllByRole('button', { name: 'Stop trusting this site' })[0]!)

    await waitFor(() => expect(screen.queryByText('https://shop.example.com')).toBeNull())
    expect(saveAppSettings).toHaveBeenCalledWith({ webmcpTrustedOrigins: [kept] })
    expect(screen.getByText('https://docs.example.com')).toBeTruthy()
  })

  it('persists the toggle and reveals the grants panel from the saved value', async () => {
    await renderPage({ webmcpEnabled: false })
    saveAppSettings.mockResolvedValue(settings({ webmcpEnabled: true }))

    fireEvent.click(webmcpSwitch())

    await waitFor(() => expect(screen.getByText('Trusted sites')).toBeTruthy())
    expect(saveAppSettings).toHaveBeenCalledWith({ webmcpEnabled: true })
  })

  it('keeps WebMCP independent of the CDP master switch', async () => {
    // The experimental rows below go disabled without CDP; WebMCP is its own gate.
    await renderPage({ cdpEnabled: false })
    expect(screen.getByText('Trusted sites')).toBeTruthy()
    expect(webmcpSwitch().getAttribute('data-disabled')).toBeNull()
  })
})

describe('browser settings — download directory', () => {
  it('shows the OS Downloads folder, labelled as the default, when nothing is configured', async () => {
    await renderPage()

    expect(await screen.findByText('/Users/dev/Downloads')).toBeInTheDocument()
    expect(screen.getByText('Using the system Downloads folder.')).toBeInTheDocument()
  })

  it('shows the configured directory without the system-default note', async () => {
    await renderPage({ browserDownloadDir: '/Users/dev/Downloads/SuperOne' })

    expect(await screen.findByText('/Users/dev/Downloads/SuperOne')).toBeInTheDocument()
    expect(screen.queryByText('Using the system Downloads folder.')).not.toBeInTheDocument()
  })

  it('persists the folder the user picks and shows it straight away', async () => {
    selectFolder.mockResolvedValue('/Users/dev/Desktop/dl')
    saveAppSettings.mockResolvedValue(settings({ browserDownloadDir: '/Users/dev/Desktop/dl' }))
    await renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Change' }))

    await waitFor(() => {
      expect(saveAppSettings).toHaveBeenCalledWith({ browserDownloadDir: '/Users/dev/Desktop/dl' })
    })
    expect(await screen.findByText('/Users/dev/Desktop/dl')).toBeInTheDocument()
  })

  it('leaves the setting untouched when the folder dialog is cancelled', async () => {
    selectFolder.mockResolvedValue(null)
    await renderPage({ browserDownloadDir: '/Users/dev/Downloads/SuperOne' })

    fireEvent.click(screen.getByRole('button', { name: 'Change' }))

    await waitFor(() => expect(selectFolder).toHaveBeenCalled())
    expect(saveAppSettings).not.toHaveBeenCalled()
    expect(screen.getByText('/Users/dev/Downloads/SuperOne')).toBeInTheDocument()
  })

  it('offers the reset control only once a directory is configured, and restores the OS folder', async () => {
    saveAppSettings.mockResolvedValue(settings({ browserDownloadDir: null }))
    const { unmount } = await renderPage()
    expect(screen.queryByRole('button', { name: 'Use the system Downloads folder' })).toBeNull()
    unmount()

    await renderPage({ browserDownloadDir: '/Users/dev/Downloads/SuperOne' })
    fireEvent.click(screen.getByRole('button', { name: 'Use the system Downloads folder' }))

    await waitFor(() => expect(saveAppSettings).toHaveBeenCalledWith({ browserDownloadDir: null }))
    expect(await screen.findByText('/Users/dev/Downloads')).toBeInTheDocument()
  })
})
