import type { Meta, StoryObj } from '@storybook/react-vite'
import i18n from 'i18next'
import { expect, userEvent, within } from 'storybook/test'
import type { PairedDevice } from '@superone/shared/agent-types'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { useAppStore } from '@/stores/app'
import { RemotePage } from './RemotePage'
import { ENVIRONMENT_ITEMS, mockEnvironmentApi } from './settings/environments/story-fixtures'

type Params = {
  devices?: PairedDevice[]
  enabled?: boolean
  relay?: boolean
  lan?: boolean
  expireOnMount?: boolean
  remoteNodes?: boolean
}

const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString()

const DEVICES: PairedDevice[] = [
  { id: 'iphone', name: 'Hangqi’s iPhone', pairedAt: day(30), lastSeenAt: day(0), online: true, transport: 'relay' },
  { id: 'pixel', name: 'Google Pixel 8', pairedAt: day(60), lastSeenAt: day(9), online: false },
  { id: 'ipad', name: 'iPad Pro with a remarkably long device name that has to truncate', pairedAt: day(90), lastSeenAt: null, online: false },
  { id: 'mbp', name: 'Studio MacBook Pro', pairedAt: day(12), lastSeenAt: day(1), online: false, clientKind: 'desktop' },
]

let codeReceived: ((payload: { deviceName: string }) => void) | null = null

const meta: Meta<typeof RemotePage> = {
  title: 'Settings/Remote',
  component: RemotePage,
  parameters: { layout: 'fullscreen' },
  beforeEach: ({ parameters }) => {
    const p = parameters as Params
    let devices = p.devices ?? []
    mockIpc('app', 'listPairedDevices', async () => devices)
    mockIpc('app', 'removePairedDevice', async (id: unknown) => { devices = devices.filter((d) => d.id !== id) })
    mockIpc('app', 'getHostname', async () => 'hangqi-mbp.local')
    mockIpc('app', 'getRelayStatus', async () => p.relay ?? true)
    mockIpc('app', 'getLanStatus', async () => p.lan ?? false)
    mockIpc('app', 'saveRemoteConfig', async () => undefined)
    mockIpc('app', 'startPairing', async () => ({ channelId: 'c0ffee', tempKeyHex: 'ab'.repeat(16), relayUrl: 'wss://relay.superone.dev' }))
    mockIpc('app', 'cancelPairing', async () => undefined)
    mockIpc('app', 'confirmPairing', async () => undefined)
    mockIpc('app', 'onPairingCodeReceived', (cb: unknown) => {
      codeReceived = cb as typeof codeReceived
      return () => { codeReceived = null }
    })
    mockIpc('app', 'onPairingExpired', (cb: unknown) => {
      const timer = p.expireOnMount ? setTimeout(cb as () => void, 0) : undefined
      return () => clearTimeout(timer)
    })
    const previous = useAppStore.getState()
    useAppStore.setState({
      remoteConfig: { enabled: p.enabled ?? true, masterSecret: 'secret', deviceId: 'device-1', relayUrl: 'wss://relay.superone.dev' },
      experimentalRemoteNodesEnabled: p.remoteNodes ?? false,
    })
    const restoreEnvironment = mockEnvironmentApi(ENVIRONMENT_ITEMS)
    return () => {
      restoreEnvironment()
      useAppStore.setState({ remoteConfig: previous.remoteConfig, experimentalRemoteNodesEnabled: previous.experimentalRemoteNodesEnabled })
    }
  },
  decorators: [
    (Story) => (
      <div className="h-[860px] overflow-y-auto bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof RemotePage>

/** Remote control on, nothing paired yet. */
export const Unpaired: Story = {}

/** Remote control off: pairing is disabled. */
export const Disabled: Story = { parameters: { enabled: false, relay: false } }

/** Phones and a desktop controller: online, last seen, never connected, long name. */
export const PairedWithDevices: Story = { parameters: { devices: DEVICES, lan: true } }

/** Scanning step: QR code inline in the Mobile card. */
export const WaitingForScan: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: i18n.t('resources.remote.pairNewPhone') }))
  },
}

/** The phone scanned and sent its name: enter the 6-digit code. */
export const WaitingForCode: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: i18n.t('resources.remote.pairNewPhone') }))
    await canvas.findByRole('button', { name: i18n.t('common.cancel') })
    codeReceived?.({ deviceName: 'iPhone' })
    await expect(await canvas.findByLabelText(i18n.t('resources.remote.stepCode'))).toBeInTheDocument()
  },
}

/** The pairing session expired: the error sits in the Mobile card. */
export const PairingExpired: Story = {
  parameters: { devices: DEVICES.slice(0, 1), expireOnMount: true },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(i18n.t('resources.remote.sessionExpired'))).toBeInTheDocument()
  },
}

/** Experimental remote nodes on: the header switches to "Control other devices". */
export const OtherDevices: Story = {
  parameters: { remoteNodes: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('tab', { name: i18n.t('settings.remote.tabs.otherDevices') }))
    await expect(await canvas.findByText('build-box')).toBeInTheDocument()
  },
}

export const Narrow: Story = {
  parameters: { devices: DEVICES, remoteNodes: true },
  decorators: [(Story) => <div className="w-[520px]"><Story /></div>],
}
