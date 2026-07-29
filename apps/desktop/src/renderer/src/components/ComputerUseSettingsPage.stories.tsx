import type { Meta, StoryObj } from '@storybook/react-vite'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { ComputerUseSettingsPage } from './ComputerUseSettingsPage'

let settings = {
  computerUseEnabled: true,
  computerUseAllowAllApps: false,
  computerUseAlwaysAllowApps: [
    { app: 'TextEdit', bundleId: 'com.apple.TextEdit' },
    { app: 'Preview', bundleId: 'com.apple.Preview' },
  ],
}

mockIpc('app', 'getAppSettings', async () => settings)
mockIpc('app', 'saveAppSettings', async (patch: unknown) => {
  settings = { ...settings, ...(patch as Partial<typeof settings>) }
  return settings
})
mockIpc('app', 'openComputerUsePermissions', async () => ({
  requested: false,
  accessibility: 'granted',
  screenRecording: 'granted',
  helperPath: '/Applications/SuperOne Computer Use.app',
  reason: 'already_granted',
}))
mockIpc('app', 'listComputerUseRunningApps', async () => [
  { app: 'Finder', bundleId: 'com.apple.finder', pid: 101, frontmost: true },
  { app: 'Notes', bundleId: 'com.apple.Notes', pid: 102, frontmost: false },
  { app: 'Safari', bundleId: 'com.apple.Safari', pid: 103, frontmost: false },
])
mockIpc('app', 'startDrag', () => undefined)

const meta: Meta<typeof ComputerUseSettingsPage> = {
  title: 'Settings/Computer Use',
  component: ComputerUseSettingsPage,
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
type Story = StoryObj<typeof ComputerUseSettingsPage>

export const Enabled: Story = {}
