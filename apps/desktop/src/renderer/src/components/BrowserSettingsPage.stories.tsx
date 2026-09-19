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
  jevFastLoopEnabled: false,
  browserDownloadDir: null as string | null,
  webmcpEnabled: false,
  webmcpTrustedOrigins: [] as WebmcpTrustedOrigin[],
}

let settings = { ...BASE }
let jevKey = { configured: false, masked: '' }

mockIpc('app', 'getAppSettings', async () => settings)
mockIpc('app', 'getDefaultDownloadDir', async () => '/Users/dev/Downloads')
mockIpc('app', 'selectFolder', async () => '/Users/dev/Downloads/SuperOne')
mockIpc('app', 'saveAppSettings', async (patch: unknown) => {
  settings = { ...settings, ...(patch as Partial<typeof settings>) }
  return settings
})
mockIpc('app', 'getJevApiKeyStatus', async () => jevKey)
mockIpc('app', 'setJevApiKey', async (key: unknown) => {
  jevKey = { configured: true, masked: `***${String(key).slice(-6)}` }
  return jevKey
})

/**
 * The page loads its state from `getAppSettings` on mount, so a story picks its variant by
 * seeding the shared mock during render — before that effect runs.
 */
function seed(patch: Partial<typeof BASE>, key: { configured: boolean; masked: string } = { configured: false, masked: '' }) {
  return (Story: () => ReactElement) => {
    settings = { ...BASE, ...patch }
    jevKey = key
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
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-5xl p-8">
        <Story />
      </div>
    ),
  ],
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

/**
 * The revoke surface. Each row is one origin with the number of tool fingerprints pinned at
 * trust time; the trash button drops the origin, which forces a fresh trust prompt next visit.
 */
export const WebMcpWithGrants: Story = {
  decorators: [
    seed({
      webmcpEnabled: true,
      webmcpTrustedOrigins: [
        grant('https://shop.example.com', ['add_to_cart', 'search_catalog', 'checkout']),
        grant('https://docs.example.com', ['get_page_outline']),
        grant('https://a-very-long-subdomain-name.internal.corp.example.com:8443', ['run_report', 'export_csv']),
      ],
    }),
  ],
}

/** CDP off — the experimental rows below WebMCP go disabled, but the WebMCP panel does not. */
export const CdpDisabled: Story = {
  decorators: [seed({ cdpEnabled: false, webmcpEnabled: true })],
}

/** Jev loop on with a stored key — the masked key and its replace control show under the row. */
export const JevFastLoopEnabled: Story = {
  decorators: [seed({ jevFastLoopEnabled: true }, { configured: true, masked: '***k7q2m9' })],
}

/** Jev loop off and no key yet — flipping the switch opens the key form instead of enabling. */
export const JevFastLoopNeedsKey: Story = {
  decorators: [seed({ jevFastLoopEnabled: false })],
}
