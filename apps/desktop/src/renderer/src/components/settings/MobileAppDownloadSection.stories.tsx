import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import i18n from 'i18next'
import { expect, userEvent, within } from 'storybook/test'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { MobileAppDownloadPanel, MobileAppDownloadSection, type MobileAppDownloadsState } from './MobileAppDownloadSection'
import { ALPHA_DOWNLOADS, STABLE_DOWNLOADS } from './mobile-app-download-fixtures'

function Panel({ state, alpha = false, initiallyExpanded = true }: {
  state: MobileAppDownloadsState
  alpha?: boolean
  initiallyExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded)
  return (
    <MobileAppDownloadPanel
      alpha={alpha}
      state={state}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      onRetry={() => {}}
    />
  )
}

const meta: Meta<typeof Panel> = {
  title: 'Settings/Remote/Mobile App',
  component: Panel,
  decorators: [
    (Story) => (
      <div className="max-w-2xl bg-background p-6 text-foreground">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof Panel>

/** Stable desktop: both stable apps. */
export const Stable: Story = {
  args: { state: { status: 'ready', downloads: STABLE_DOWNLOADS } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('button', { name: i18n.t('settings.remote.thisDevice.mobileApp.copyLink') })).toHaveLength(2)
  },
}

/** Alpha desktop: the title names the alpha line its phones must match. */
export const Alpha: Story = {
  args: { alpha: true, state: { status: 'ready', downloads: ALPHA_DOWNLOADS } },
}

/** One platform not published on this track yet. */
export const OnePlatformMissing: Story = {
  args: { alpha: true, state: { status: 'ready', downloads: { ...ALPHA_DOWNLOADS, ios: null } } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(i18n.t('settings.remote.thisDevice.mobileApp.unavailable'))).toBeInTheDocument()
  },
}

export const Loading: Story = { args: { state: { status: 'loading' } } }

/** Offline or the CDN unreachable: one retry for both. */
export const Unreachable: Story = {
  args: { state: { status: 'error' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: i18n.t('settings.remote.thisDevice.mobileApp.retry') })).toBeInTheDocument()
  },
}

/** A phone is already paired: collapsed until opened. */
export const Collapsed: Story = {
  args: { initiallyExpanded: false, state: { status: 'ready', downloads: STABLE_DOWNLOADS } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const header = canvas.getByRole('button', { name: new RegExp(i18n.t('settings.remote.thisDevice.mobileApp.title')) })
    await expect(header).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(header)
    await expect(header).toHaveAttribute('aria-expanded', 'true')
  },
}

export const Narrow: Story = {
  args: { state: { status: 'ready', downloads: STABLE_DOWNLOADS } },
  decorators: [(Story) => <div className="w-[360px]"><Story /></div>],
}

/** The connected section: loads over IPC, expanded with no phone paired. */
export const Connected: StoryObj<typeof MobileAppDownloadSection> = {
  render: () => <MobileAppDownloadSection hasPairedPhones={false} />,
  beforeEach: () => {
    mockIpc('app', 'getMobileAppDownloads', async () => STABLE_DOWNLOADS)
  },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findAllByText('1.0.0 (build 34)')).toHaveLength(2)
  },
}
