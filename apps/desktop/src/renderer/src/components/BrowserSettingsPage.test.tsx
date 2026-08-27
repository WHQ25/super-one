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

Object.defineProperty(window, 'app', {
  configurable: true,
  value: { getAppSettings, saveAppSettings },
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
