import type { Meta, StoryObj } from '@storybook/react-vite'
import i18n from 'i18next'
import { expect, userEvent, within } from 'storybook/test'
import type { EnvironmentListItem } from '@superone/shared/environment'
import { EnvironmentsPage } from './EnvironmentsPage'
import { DESKTOP_PATH_ITEMS, DESKTOP_STATUS_ITEMS, ENVIRONMENT_ITEMS, mockEnvironmentApi } from './story-fixtures'

type Params = { items?: EnvironmentListItem[] | null; labReachable?: boolean; width?: number }

/**
 * "Control other devices" body as it sits under Settings → Remote Control. One section per
 * channel; each device is a card row. The dev-only Local lab section shows in `storybook dev`.
 */
const meta: Meta<typeof EnvironmentsPage> = {
  title: 'Settings/Remote/Environments',
  component: EnvironmentsPage,
  parameters: { layout: 'padded' },
  beforeEach: ({ parameters }) => {
    const { items = ENVIRONMENT_ITEMS, labReachable } = parameters as Params
    return mockEnvironmentApi(items, { labReachable })
  },
  decorators: [
    (Story, { parameters }) => (
      <div className="mx-auto max-w-3xl" style={{ width: (parameters as Params).width }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof EnvironmentsPage>

export const Loading: Story = { parameters: { items: null } }

export const Empty: Story = { parameters: { items: [] } }

/** Connected (with its harness list), outdated node, backoff, auth-blocked and identity-conflict rows. */
export const Populated: Story = {}

export const LabOnline: Story = { parameters: { items: ENVIRONMENT_ITEMS.slice(0, 1), labReachable: true } }

export const Narrow: Story = { parameters: { width: 460 } }

/** Paired desktops on the LAN, over Tailscale and over the relay; a reconnecting one shows no path. */
export const ConnectionPaths: Story = {
  parameters: { items: DESKTOP_PATH_ITEMS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const path of ['lan', 'tailscale', 'relay'] as const) {
      await expect(await canvas.findByText(i18n.t(`settings.environments.path.${path}`))).toBeInTheDocument()
    }
  },
}

export const ConnectionPathsNarrow: Story = { parameters: { items: DESKTOP_PATH_ITEMS, width: 460 } }

/**
 * Desktop rows read like Control This Mac: online with its path, or why not
 * (offline, control paused on that computer, connecting, unpaired) and Retry.
 * No endpoint URL, no separate Connect, and the raw error only as a tooltip.
 */
export const DesktopStates: Story = {
  parameters: { items: DESKTOP_STATUS_ITEMS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText(i18n.t('settings.environments.offline'))).toBeInTheDocument()
    await expect(canvas.getByText(i18n.t('settings.environments.accessPaused'))).toBeInTheDocument()
    await expect(canvas.queryByText(/not connected to the relay/)).toBeNull()
    await expect(canvas.queryByText('http://VensendeMac-mini.local:7792')).toBeNull()
    await expect(canvas.queryByRole('button', { name: i18n.t('settings.environments.connect') })).toBeNull()
    await expect(canvas.getAllByRole('button', { name: i18n.t('settings.environments.retryNow') })).toHaveLength(2)
  },
}

export const DesktopStatesNarrow: Story = { parameters: { items: DESKTOP_STATUS_ITEMS, width: 460 } }

/** Desktop card → Add Desktop (+) opens the pairing dialog with a QR for the phone. */
export const AddDesktop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: i18n.t('settings.remote.addDesktop.button') }))
    await expect(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: i18n.t('settings.remote.addDesktop.title') }),
    ).toBeInTheDocument()
  },
}
