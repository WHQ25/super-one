import type { Meta, StoryObj } from '@storybook/react-vite'
import i18n from 'i18next'
import { expect, userEvent, within } from 'storybook/test'
import type { NodeHostPairingToken, NodeHostStatus } from '@superone/shared/agent-types'
import { mockIpc } from '../../../../../../.storybook/mock-ipc'
import { NodeAccessSection } from './NodeAccessSection'

type Params = {
  enabled?: boolean
  port?: number | null
  status?: NodeHostStatus
  /** Never resolve the settings save, so the starting state stays on screen. */
  hangSave?: boolean
  /** Mint a token that is already expired. */
  expired?: boolean
  note?: string
  width?: number
}

const LISTENING: NodeHostStatus = {
  running: true,
  url: 'http://Hangqis-Studio.local:7791',
  environmentId: 'env-9f3c2a',
  error: null,
}

const LONG_HOST: NodeHostStatus = {
  ...LISTENING,
  url: 'http://hangqi-studio-display-workstation-with-a-very-long-bonjour-name.local:47791',
}

const FAILED: NodeHostStatus = {
  running: false,
  url: null,
  environmentId: null,
  error: 'listen EADDRINUSE: address already in use 0.0.0.0:7791',
}

const OFF: NodeHostStatus = { running: false, url: null, environmentId: null, error: null }

function token(expired: boolean): NodeHostPairingToken {
  return {
    url: LISTENING.url!,
    lan: { host: 'Hangqis-Studio.local', port: 7791 },
    relay: { url: 'wss://relay.superone.example', room: '0f'.repeat(16) },
    environmentId: 'env-9f3c2a',
    nodePublicKeyFingerprint: 'sha256:2f9a',
    tokenId: 'tok_7d1e',
    pairingToken: 'pt_Jx8m2W0qLr4nB6sVt3yHc1kA',
    channel: { keyId: 'tok_7d1e', secretHex: 'e4620c0bf60dd8153f5073df3027f93dd7616ff89520dfbc6594907857bf6e6d' },
    expiresAt: expired ? Date.now() - 1_000 : Date.now() + 10 * 60_000,
  }
}

/**
 * Settings → Remote Control → Control This Mac: serve this computer to paired
 * desktops (behind the experimental remote nodes flag). All IPC is mocked.
 */
const meta: Meta<typeof NodeAccessSection> = {
  title: 'Settings/Remote/Node Access',
  component: NodeAccessSection,
  parameters: { layout: 'padded' },
  beforeEach: ({ parameters }) => {
    const p = parameters as Params
    let enabled = p.enabled ?? false
    let port = p.port ?? null
    let note = p.note ?? ''
    const status = () => (enabled ? p.status ?? LISTENING : OFF)
    const settings = () => ({ remoteNodeAccessEnabled: enabled, remoteNodeAccessPort: port })
    mockIpc('app', 'getAppSettings', async () => settings())
    mockIpc('app', 'getNodeHostStatus', async () => status())
    mockIpc('app', 'saveAppSettings', (patch: unknown) => {
      if (p.hangSave) return new Promise(() => {})
      const next = patch as { remoteNodeAccessEnabled?: boolean; remoteNodeAccessPort?: number | null }
      if (next.remoteNodeAccessEnabled !== undefined) enabled = next.remoteNodeAccessEnabled
      if (next.remoteNodeAccessPort !== undefined) port = next.remoteNodeAccessPort
      return new Promise((resolve) => setTimeout(() => resolve(settings()), 300))
    })
    mockIpc('app', 'mintNodeHostPairingToken', async () => token(p.expired ?? false))
    mockIpc('app', 'getNodeHostNote', async () => note)
    mockIpc('app', 'setNodeHostNote', async (value: unknown) => {
      note = String(value).trim()
      return note
    })
  },
  decorators: [
    (Story, { parameters }) => (
      <div className="mx-auto max-w-3xl bg-background text-foreground" style={{ width: (parameters as Params).width }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof NodeAccessSection>

const addDevice = () => i18n.t('settings.remote.nodeAccess.addDevice')

/** Default: off, nothing listens. */
export const Off: Story = {}

/** Toggling on while main is still starting the server. */
export const Starting: Story = {
  parameters: { hangSave: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('switch'))
    await expect(await canvas.findByText(i18n.t('settings.remote.nodeAccess.status.starting'))).toBeInTheDocument()
  },
}

export const Listening: Story = { parameters: { enabled: true, note: 'Has the RTX 4090; prefer it for model builds.' } }

/** The port is taken: the error comes from main's start attempt. */
export const StartError: Story = { parameters: { enabled: true, port: 7791, status: FAILED } }

export const InvalidPort: Story = {
  parameters: { enabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = await canvas.findByLabelText(i18n.t('settings.remote.nodeAccess.port'))
    await userEvent.type(input, '80{Enter}')
    await expect(await canvas.findByText(i18n.t('settings.remote.nodeAccess.portInvalid'))).toBeInTheDocument()
  },
}

/** Add Device: the code with QR, copy and countdown. */
export const PairingCode: Story = {
  parameters: { enabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: addDevice() }))
    await expect(await canvas.findByRole('button', { name: i18n.t('settings.remote.nodeAccess.code.copy') })).toBeInTheDocument()
  },
}

export const PairingCodeDark: Story = { ...PairingCode, globals: { theme: 'dark' } }

export const PairingCodeExpired: Story = {
  parameters: { enabled: true, expired: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: addDevice() }))
    await expect(await canvas.findByText(i18n.t('settings.remote.nodeAccess.code.expired'))).toBeInTheDocument()
  },
}

/** Editing the owner note reveals Save. */
export const NoteEditing: Story = {
  parameters: { enabled: true, note: 'Mac Studio in the office.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const field = await canvas.findByLabelText(i18n.t('settings.remote.nodeAccess.note.label'))
    await expect(field).toHaveValue('Mac Studio in the office.')
    await userEvent.type(field, ' Xcode 26 and Docker installed.')
    await expect(await canvas.findByRole('button', { name: i18n.t('settings.remote.nodeAccess.note.save') })).toBeEnabled()
  },
}

export const LongContent: Story = {
  parameters: {
    enabled: true,
    status: LONG_HOST,
    note: 'Office Mac Studio (M3 Ultra, 192 GB). Prefer it for iOS builds, simulator runs and long test suites. Avoid between 9:00 and 10:00 when backups run; the external SSD is mounted at /Volumes/Work and holds the large monorepos.',
  },
}

export const Narrow: Story = { ...PairingCode, parameters: { enabled: true, width: 360 } }

export const Chinese: Story = { ...PairingCode, globals: { locale: 'zh' } }
