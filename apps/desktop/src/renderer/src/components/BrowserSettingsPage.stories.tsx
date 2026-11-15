import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactElement } from 'react'
import type { WebmcpTrustedOrigin } from '@superone/shared/agent-types'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { BrowserSettingsPage } from './BrowserSettingsPage'

const BASE = {
  cdpEnabled: true,
  cdpCookiesEnabled: true,
  cdpMockEnabled: false,
  cdpEmulateEnabled: false,
  browserDownloadDir: null as string | null,
  webmcpEnabled: false,
  webmcpTrustedOrigins: [] as WebmcpTrustedOrigin[],
}

let settings = { ...BASE }
let chromeStatus = { connected: false, extensionDir: '/Users/dev/.superone/dev/chrome-extension' }

mockIpc('app', 'getAppSettings', async () => settings)
mockIpc('app', 'getDefaultDownloadDir', async () => '/Users/dev/Downloads')
mockIpc('app', 'selectFolder', async () => '/Users/dev/Downloads/SuperOne')
mockIpc('app', 'saveAppSettings', async (patch: unknown) => {
  settings = { ...settings, ...(patch as Partial<typeof settings>) }
  return settings
})
mockIpc('app', 'getChromeBridgeStatus', async () => chromeStatus)
mockIpc('app', 'revealChromeExtension', async () => {})
mockIpc('app', 'startDrag', () => undefined)
mockIpc('app', 'clipboardWrite', async () => {})
mockIpc('app', 'listChromeExtensionBrowsers', async () => ['chrome', 'edge'])
mockIpc('app', 'openChromeExtensionPage', async (browserId: unknown) => ({
  opened: browserId !== 'arc',
  url: browserId === 'edge' ? 'edge://extensions' : browserId === 'brave' ? 'brave://extensions' : 'chrome://extensions',
}))
mockIpc('app', 'onChromeBridgeStatus', () => () => {})

/**
 * The page loads its state from `getAppSettings` on mount, so a story picks its variant by
 * seeding the shared mock during render — before that effect runs.
 */
function seed(patch: Partial<typeof BASE>, chromeConnected = false) {
  return (Story: () => ReactElement) => {
    settings = { ...BASE, ...patch }
    chromeStatus = { ...chromeStatus, connected: chromeConnected }
    return <Story />
  }
}

const grant = (origin: string, tools: string[]): WebmcpTrustedOrigin => ({
  origin,
  tools: Object.fromEntries(tools.map((name) => [name, `fingerprint:${name}`])),
})

const meta: Meta<typeof BrowserSettingsPage> = {
  title: 'Settings/Browser',
  component: BrowserSettingsPage,
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof BrowserSettingsPage>

/** WebMCP off — the grants panel is hidden entirely, not shown empty. */
export const WebMcpDisabled: Story = {
  decorators: [seed({ webmcpEnabled: false, webmcpTrustedOrigins: [grant('https://shop.example.com', ['a'])] })],
}

/** On, but nothing trusted yet — the panel has to explain itself rather than show a blank list. */
export const WebMcpNoGrants: Story = {
  decorators: [seed({ webmcpEnabled: true })],
}

const withGrants = seed({
  webmcpEnabled: true,
  webmcpTrustedOrigins: [
    grant('https://shop.example.com', ['add_to_cart', 'search_catalog', 'checkout']),
    grant('https://docs.example.com', ['get_page_outline']),
    grant('https://a-very-long-subdomain-name.internal.corp.example.com:8443', ['run_report', 'export_csv']),
  ],
})

/**
 * The revoke surface. Each row is one origin with the number of tool fingerprints pinned at
 * trust time; the trash button drops the origin, which forces a fresh trust prompt next visit.
 */
export const WebMcpWithGrants: Story = {
  decorators: [withGrants],
}

/** Pick a browser, open or copy its extensions page, then drag the folder onto that page. */
export const ExtensionNotLoaded: Story = {
  decorators: [seed({})],
}

/** A connected extension is what makes @ Chrome use browser tools. */
export const ExtensionConnected: Story = {
  decorators: [seed({}, true)],
}

/** CDP off — the experimental rows below WebMCP go disabled, but the WebMCP panel does not. */
export const CdpDisabled: Story = {
  decorators: [seed({ cdpEnabled: false, webmcpEnabled: true })],
}

/** A configured folder shows its path and a reset button back to the OS Downloads folder. */
export const CustomDownloadDir: Story = {
  decorators: [seed({ browserDownloadDir: '/Users/dev/Library/Mobile Documents/com~apple~CloudDocs/Downloads/SuperOne Browser' })],
}

export const Dark: Story = {
  decorators: [withGrants],
  globals: { theme: 'dark' },
}

/** Long origins and paths truncate; controls keep their width. */
export const Narrow: Story = {
  decorators: [
    withGrants,
    (Story) => (
      <div className="w-[420px]">
        <Story />
      </div>
    ),
  ],
}
