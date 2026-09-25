import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactElement } from 'react'
import { DEFAULT_NOTIFICATION_SETTINGS } from '@superone/shared/notifications'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { useAppStore } from '@/stores/app'
import { SettingsLayout } from './SettingsLayout'

const GB = 1024 ** 3

let appSettings: Record<string, unknown> = {
  analyticsEnabled: true,
  powerMode: 'system',
  notifications: DEFAULT_NOTIFICATION_SETTINGS,
  jevFastLoopEnabled: false,
}

mockIpc('app', 'getAppSettings', async () => ({ ...appSettings }))
mockIpc('app', 'saveAppSettings', async (patch: unknown) => {
  appSettings = { ...appSettings, ...(patch as Record<string, unknown>) }
  return { ...appSettings }
})
mockIpc('app', 'getJevApiKeyStatus', async () => ({ configured: false, masked: '' }))
mockIpc('app', 'getSyncZoneUsage', async () => ({
  root: '/Users/dev/Library/Application Support/SuperOne/sync',
  totalBytes: 3.2 * GB,
  sessionCount: 42,
  adhocBytes: 0,
  pendingBytes: 0,
  reclaimable: { sessions: 0, bytes: 0 },
  failedHandoffs: { files: 0, bytes: 0, lastError: null },
  needsRedelivery: { files: 0, bytes: 0 },
}))
mockIpc('app', 'checkForUpdates', async () => undefined)
mockIpc('app', 'listPlatforms', async () => [])
mockIpc('app', 'listCredentials', async () => [])
mockIpc('app', 'listBindings', async () => [])

function seed(patch: Partial<ReturnType<typeof useAppStore.getState>>) {
  return (Story: () => ReactElement) => {
    useAppStore.setState({
      settingsTab: 'app-settings',
      appVersion: '0.71.2',
      appVariant: 'stable',
      alphaDownloadUrl: 'https://example.com/alpha',
      updateStatus: 'idle',
      ...patch,
    })
    return <Story />
  }
}

const meta: Meta<typeof SettingsLayout> = {
  title: 'Settings/Layout',
  component: SettingsLayout,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="flex h-[860px] bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof SettingsLayout>

/** Grouped sidebar with the General page: every group is one tinted card with inset dividers. */
export const General: Story = { decorators: [seed({})] }

/** An update mid-download puts a progress bar under the update row. */
export const UpdateDownloading: Story = {
  decorators: [seed({ updateStatus: 'downloading', updateVersion: '0.72.0', updateProgress: 42 })],
}

/** The sidebar keeps its width and the content column shrinks. */
export const Narrow: Story = {
  decorators: [seed({}), (Story) => <div className="flex w-[720px]"><Story /></div>],
}
