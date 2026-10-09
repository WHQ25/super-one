import type { Meta, StoryObj } from '@storybook/react-vite'
import i18n from 'i18next'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import type { ControllerPairingEvent, NodeHostController, NodeHostStatus } from '@superone/shared/agent-types'
import { mockIpc } from '../../../../../../.storybook/mock-ipc'
import { DesktopControllersSection } from './DesktopControllersSection'

type Params = {
  controllers?: NodeHostController[]
  status?: NodeHostStatus
  /** Event the mocked main sends right after the QR opens. */
  afterStart?: ControllerPairingEvent
  width?: number
}

const QR = 'superone://pair-controller?channel=c0ffee&key=' + 'ab'.repeat(32) + '&relay=wss%3A%2F%2Frelay.superone.dev&name=Studio'
const DAY = 86_400_000

const CONTROLLERS: NodeHostController[] = [
  { id: 'c1', label: 'MacBook Pro', pairedAt: Date.now() - 3 * DAY, lastUsedAt: Date.now(), enabled: true, platform: 'darwin', path: 'lan' },
  {
    id: 'c2',
    label: 'Office workstation with a remarkably long machine name that has to truncate',
    pairedAt: Date.now() - 40 * DAY,
    lastUsedAt: Date.now() - 9 * DAY,
    // Kept out by this computer without being unpaired.
    enabled: false,
    platform: 'win32',
    path: null,
  },
]

const RUNNING: NodeHostStatus = { running: true, url: 'http://Studio.local:7791', environmentId: 'env-1', error: null }

let emit: ((event: ControllerPairingEvent) => void) | null = null

/**
 * Settings → Remote Control → Control This Computer → Desktop: desktops that
 * run tasks here, and pairing one through a phone. All IPC is mocked.
 */
const meta: Meta<typeof DesktopControllersSection> = {
  title: 'Settings/Remote/Desktop Controllers',
  component: DesktopControllersSection,
  args: { controlAllowed: true },
  parameters: { layout: 'padded' },
  beforeEach: ({ parameters }) => {
    const p = parameters as Params
    let controllers = p.controllers ?? []
    mockIpc('app', 'listNodeHostControllers', async () => controllers)
    mockIpc('app', 'getNodeHostStatus', async () => p.status ?? RUNNING)
    mockIpc('app', 'setNodeHostControllerEnabled', async (id: unknown, enabled: unknown) => {
      controllers = controllers.map((c) => c.id === id ? { ...c, enabled: enabled === true } : c)
    })
    mockIpc('app', 'removeNodeHostController', async (id: unknown) => {
      controllers = controllers.filter((c) => c.id !== id)
    })
    mockIpc('app', 'onControllerPairingEvent', (cb: unknown) => {
      emit = cb as typeof emit
      return () => { emit = null }
    })
    mockIpc('app', 'startControllerPairing', async () => {
      if (p.afterStart) setTimeout(() => emit?.(p.afterStart!), 0)
      return QR
    })
    mockIpc('app', 'confirmControllerPairing', async (code: unknown) => {
      if (code !== '123456') throw new Error('Incorrect pairing code')
      emit?.({ type: 'granted', controllerName: 'MacBook Pro' })
    })
    mockIpc('app', 'cancelControllerPairing', async () => undefined)
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
type Story = StoryObj<typeof DesktopControllersSection>

const pairButton = () => ({ name: i18n.t('resources.remote.pairNewDesktop') })

/** No desktop paired: the node surface is off. */
export const Empty: Story = { parameters: { status: { running: false, url: null, environmentId: null, error: null } } }

/** Two controllers, one with a long name and its access switched off. */
export const Paired: Story = { parameters: { controllers: CONTROLLERS } }

/** Allow Control off: every switch shows off and is locked, and pairing is unavailable. */
export const ControlOff: Story = { args: { controlAllowed: false }, parameters: { controllers: CONTROLLERS } }

/** Switching a controller off keeps it paired but out until switched back on. */
export const AccessOff: Story = {
  parameters: { controllers: CONTROLLERS.slice(0, 1) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = await canvas.findByRole('switch', {
      name: i18n.t('settings.remote.thisDevice.desktop.allow', { name: 'MacBook Pro' }),
    })
    await userEvent.click(toggle)
    await expect(await canvas.findByText(i18n.t('settings.remote.thisDevice.desktop.accessOff'))).toBeInTheDocument()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
  },
}

/** The host could not start (port taken): paired desktops cannot connect. */
export const HostError: Story = {
  parameters: {
    controllers: CONTROLLERS.slice(0, 1),
    status: { running: false, url: null, environmentId: null, error: 'listen EADDRINUSE: address already in use 0.0.0.0:7791' },
  },
}

/** "Pair New Desktop" (+): a dialog with the controller QR for the phone. */
export const Scanning: Story = {
  parameters: { controllers: CONTROLLERS.slice(0, 1) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', pairButton()))
    const dialog = within(await within(document.body).findByRole('dialog'))
    await expect(await dialog.findByText(i18n.t('settings.remote.thisDevice.desktop.pairing.grants'))).toBeInTheDocument()
  },
}

/** The phone scanned for MacBook Pro: type the code it shows. A wrong code stays open for another try. */
export const EnterCode: Story = {
  parameters: { afterStart: { type: 'request', controllerName: 'MacBook Pro', phoneName: 'iPhone' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', pairButton()))
    const dialog = within(await within(document.body).findByRole('dialog'))
    const input = await dialog.findByLabelText(
      i18n.t('settings.remote.thisDevice.desktop.pairing.prompt', { phone: 'iPhone', name: 'MacBook Pro' }),
    )
    // The field autofocuses before user-event watches focus, so its typing would
    // bypass React's onChange; refocus through user-event first.
    input.blur()
    await userEvent.type(input, '000000')
    await userEvent.click(dialog.getByRole('button', { name: i18n.t('resources.remote.confirm') }))
    await expect(await dialog.findByText(i18n.t('resources.remote.codeError'))).toBeInTheDocument()
  },
}

/** The right code: the dialog closes and the controller finishes pairing on its side. */
export const Granted: Story = {
  parameters: { afterStart: { type: 'request', controllerName: 'MacBook Pro', phoneName: 'iPhone' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', pairButton()))
    const dialog = within(await within(document.body).findByRole('dialog'))
    const input = await dialog.findByLabelText(
      i18n.t('settings.remote.thisDevice.desktop.pairing.prompt', { phone: 'iPhone', name: 'MacBook Pro' }),
    )
    // The field autofocuses before user-event watches focus, so its typing would
    // bypass React's onChange; refocus through user-event first.
    input.blur()
    await userEvent.type(input, '123456')
    await userEvent.click(dialog.getByRole('button', { name: i18n.t('resources.remote.confirm') }))
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
  },
}

/** Nobody scanned before the relay closed the room: the dialog closes with a notice. */
export const Expired: Story = {
  parameters: { afterStart: { type: 'ended', reason: 'expired' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', pairButton()))
    await expect(await canvas.findByText(i18n.t('settings.remote.thisDevice.desktop.pairing.expired'))).toBeInTheDocument()
  },
}

export const Narrow: Story = { parameters: { controllers: CONTROLLERS, width: 420 } }
