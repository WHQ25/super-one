/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
const getChromeBridgeStatus = vi.fn()
const revealChromeExtension = vi.fn()
const startDrag = vi.fn()
const listChromeExtensionBrowsers = vi.fn()
const openChromeExtensionPage = vi.fn()
const clipboardWrite = vi.fn()

Object.defineProperty(window, 'app', {
  configurable: true,
  value: {
    getAppSettings,
    saveAppSettings,
    getDefaultDownloadDir,
    selectFolder,
    getChromeBridgeStatus,
    revealChromeExtension,
    startDrag,
    listChromeExtensionBrowsers,
    openChromeExtensionPage,
    clipboardWrite,
    onChromeBridgeStatus: () => () => {},
  },
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
    browserDownloadDir: null,
    chromeBridgeDisabledBrowsers: [] as string[],
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

/** The WebMCP switch is the one in the same settings group as the WebMCP label. */
function webmcpSwitch(): HTMLElement {
  const group = screen.getByText('WebMCP page tools').closest('section')
  return group!.querySelector('[role="switch"]') as HTMLElement
}

beforeEach(() => {
  getAppSettings.mockReset()
  saveAppSettings.mockReset()
  getDefaultDownloadDir.mockReset()
  getDefaultDownloadDir.mockResolvedValue('/Users/dev/Downloads')
  selectFolder.mockReset()
  getChromeBridgeStatus.mockReset()
  getChromeBridgeStatus.mockResolvedValue({ connected: false, extensionDir: '/Users/dev/.superone/dev/chrome-extension' })
  revealChromeExtension.mockReset()
  startDrag.mockReset()
  listChromeExtensionBrowsers.mockReset()
  listChromeExtensionBrowsers.mockResolvedValue(['chrome'])
  openChromeExtensionPage.mockReset()
  openChromeExtensionPage.mockResolvedValue({ opened: true, url: 'chrome://extensions' })
  clipboardWrite.mockReset()
  clipboardWrite.mockResolvedValue(undefined)
})

describe('browser settings — own browser', () => {
  it('walks through choosing a browser, opening or copying its extensions page, and dragging the folder', async () => {
    await renderPage()
    expect(await screen.findByText('Install Extension')).toBeTruthy()
    expect(await screen.findByText('Choose the browser to install it in.')).toBeTruthy()
    expect(screen.getByText('chrome://extensions')).toBeTruthy()

    await userEvent.click(screen.getByRole('tab', { name: 'Edge' }))
    expect(screen.getByText('edge://extensions')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Copy Address' }))
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith('edge://extensions'))

    await userEvent.click(screen.getByRole('button', { name: 'Open Page' }))
    await waitFor(() => expect(openChromeExtensionPage).toHaveBeenCalledWith('edge'))

    expect(screen.getByText(/Drag this folder onto that page/)).toBeTruthy()
    const folder = screen.getByLabelText('Drag Folder')
    expect(folder).toHaveTextContent('/Users/dev/.superone/dev/chrome-extension')
    fireEvent.dragStart(folder)
    expect(startDrag).toHaveBeenCalledWith(['/Users/dev/.superone/dev/chrome-extension'])
    fireEvent.click(screen.getByRole('button', { name: 'Show in Finder' }))
    expect(revealChromeExtension).toHaveBeenCalledOnce()
  })

  it('tells the user to copy the address when the extensions page does not open', async () => {
    openChromeExtensionPage.mockResolvedValue({ opened: false, url: 'chrome://extensions' })
    await renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Open Page' }))
    expect(await screen.findByText('Could not open Google Chrome. Copy the address and paste it into the address bar.')).toBeTruthy()
  })

  it('selects an installed browser other than Chrome when Chrome is missing', async () => {
    listChromeExtensionBrowsers.mockResolvedValue(['arc'])
    await renderPage()
    expect(await screen.findByRole('tab', { name: 'Arc', selected: true })).toBeTruthy()
    expect(screen.getByText('chrome://extensions')).toBeTruthy()
  })

  it('shows Your Browser at the top with a control toggle and keeps Install Extension for remaining browsers', async () => {
    getChromeBridgeStatus.mockResolvedValue({
      connected: true,
      browsers: ['chrome'],
      extensionDir: '/Users/dev/.superone/dev/chrome-extension',
    })
    saveAppSettings.mockResolvedValue(settings({ chromeBridgeDisabledBrowsers: ['chrome'] }))
    await renderPage()
    expect(await screen.findByText('Your Browser')).toBeTruthy()
    expect(screen.getByText('Install Extension')).toBeTruthy()
    expect(screen.getByText('Chrome')).toBeTruthy()
    expect(screen.getByText('Connected')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Chrome' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Edge' })).toBeTruthy()
    expect(screen.getByLabelText('Drag Folder')).toBeTruthy()

    const toggle = screen.getByRole('switch', { name: 'Allow browser control Chrome' })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    await waitFor(() => expect(saveAppSettings).toHaveBeenCalledWith({ chromeBridgeDisabledBrowsers: ['chrome'] }))
    expect(await screen.findByText('Connected · Control disabled')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Show in Finder' }))
    expect(revealChromeExtension).toHaveBeenCalledOnce()
  })
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
