import type { Meta, StoryObj } from '@storybook/react-vite'
import i18n from 'i18next'
import { expect, fn, within } from 'storybook/test'
import type { NodePairingEvent } from '@superone/shared/agent-types'
import { PairDesktopDialog } from './PairDesktopDialog'

type Params = {
  /** Events main sends after the QR opens, in order. */
  events?: NodePairingEvent[]
  /** `startNodePairing` rejects with this message. */
  startError?: string
}

const QR = 'superone://pair-node?channel=c0ffee&key=' + 'ab'.repeat(32) + '&relay=wss%3A%2F%2Frelay.superone.dev&name=MacBook'

/**
 * Control Other Devices → Add Desktop: the node QR a phone paired with the
 * other desktop scans. `window.environment` pairing calls are mocked.
 */
const meta = {
  title: 'Settings/Environments/Pair Desktop',
  component: PairDesktopDialog,
  args: { open: true, onOpenChange: fn(), onPaired: fn() },
  beforeEach: ({ parameters }) => {
    const p = parameters as Params
    const previousApi = window.environment
    let emit: ((event: NodePairingEvent) => void) | null = null
    window.environment = {
      ...previousApi,
      startNodePairing: async () => {
        if (p.startError) throw new Error(p.startError)
        setTimeout(() => { for (const event of p.events ?? []) emit?.(event) }, 0)
        return QR
      },
      cancelNodePairing: async () => undefined,
      onNodePairingEvent: (cb: (event: NodePairingEvent) => void) => {
        emit = cb
        return () => { emit = null }
      },
    }
    return () => { window.environment = previousApi }
  },
} satisfies Meta<typeof PairDesktopDialog>

export default meta
type Story = StoryObj<typeof meta>

const body = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body)

/** Waiting for a phone to scan. */
export const Scan: Story = {
  play: async ({ canvasElement }) => {
    await expect(await body(canvasElement).findByText(i18n.t('settings.remote.addDesktop.waiting'))).toBeInTheDocument()
  },
}

/** The phone scanned for Studio: show the code to type on the phone. */
export const ShowCode: Story = {
  parameters: { events: [{ type: 'offer', code: '482913', nodeName: 'Studio', phoneName: 'iPhone' }] },
  play: async ({ canvasElement }) => {
    await expect(await body(canvasElement).findByText('482913')).toBeInTheDocument()
  },
}

/** The phone confirmed and handed over Studio's pairing; this computer pairs it. */
export const Pairing: Story = {
  parameters: {
    events: [
      { type: 'offer', code: '482913', nodeName: 'Studio', phoneName: 'iPhone' },
      { type: 'pairing', nodeName: 'Studio' },
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(
      await body(canvasElement).findByText(i18n.t('settings.remote.addDesktop.pairing', { name: 'Studio' })),
    ).toBeInTheDocument()
  },
}

/** Studio could not be reached over any route. */
export const Unreachable: Story = {
  parameters: {
    events: [
      { type: 'pairing', nodeName: 'Studio' },
      { type: 'ended', reason: 'failed', message: 'request failed for http://Studio.local:7791: ECONNREFUSED' },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = body(canvasElement)
    await expect(await canvas.findByText(i18n.t('settings.remote.addDesktop.errors.unreachable'))).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: i18n.t('settings.remote.addDesktop.retry') })).toBeInTheDocument()
  },
}

/** Nobody scanned before the room closed. */
export const Expired: Story = {
  parameters: { events: [{ type: 'ended', reason: 'expired' }] },
  play: async ({ canvasElement }) => {
    await expect(await body(canvasElement).findByText(i18n.t('settings.remote.addDesktop.errors.qrExpired'))).toBeInTheDocument()
  },
}

/** The person cancelled on the phone. */
export const CancelledOnPhone: Story = {
  parameters: { events: [{ type: 'ended', reason: 'rejected' }] },
  play: async ({ canvasElement }) => {
    await expect(await body(canvasElement).findByText(i18n.t('settings.remote.addDesktop.errors.cancelled'))).toBeInTheDocument()
  },
}

/** No relay could be reached to open the room. */
export const StartFailed: Story = {
  parameters: { startError: 'Unexpected server response: 502 from wss://relay.superone.dev/pair' },
}
