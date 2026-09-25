import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactElement } from 'react'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { ComputerUseSettingsPage } from './ComputerUseSettingsPage'

const BASE = {
  computerUseEnabled: true,
  computerUsePictureInPicture: true,
  computerUseDedicatedDisplayId: null,
  computerUseAllowAllApps: false,
  computerUseAlwaysAllowApps: [
    { app: 'TextEdit', bundleId: 'com.apple.TextEdit' },
    { app: 'Preview', bundleId: 'com.apple.Preview' },
  ],
}

const GRANTED = {
  requested: false,
  accessibility: 'granted',
  screenRecording: 'granted',
  helperName: 'SuperOne Computer Use',
  helperBundleId: 'com.superone.computer-use',
  helperPath: '/Applications/SuperOne Computer Use.app',
  reason: 'already_granted',
}

let settings = { ...BASE }
let permissions: typeof GRANTED | Record<string, unknown> | 'pending' = GRANTED

mockIpc('app', 'getAppSettings', async () => settings)
mockIpc('app', 'saveAppSettings', async (patch: unknown) => {
  settings = { ...settings, ...(patch as Partial<typeof settings>) }
  return settings
})
mockIpc('app', 'listComputerUseDisplays', async () => [
  { id: '1', name: 'Built-in Retina Display', primary: true, internal: true },
  { id: '2', name: 'Studio Display', primary: false, internal: false },
])
mockIpc('app', 'onComputerUseDisplaysChanged', () => () => {})
mockIpc('app', 'openComputerUsePermissions', async () => (
  permissions === 'pending' ? new Promise<never>(() => {}) : permissions
))
mockIpc('app', 'recheckComputerUsePermissions', async () => GRANTED)
mockIpc('app', 'onComputerUsePermissionStatus', () => () => {})
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
}

export default meta
type Story = StoryObj<typeof ComputerUseSettingsPage>

/**
 * The page reads settings and permission status on mount, so a story seeds the
 * shared mocks during render — before those effects run.
 */
function seed(patch: Partial<typeof BASE>, nextPermissions: typeof permissions = GRANTED) {
  return (Story: () => ReactElement) => {
    settings = { ...BASE, ...patch }
    permissions = nextPermissions
    return <Story />
  }
}

export const Enabled: Story = { decorators: [seed({})] }

/** Off by default: every dependent control is disabled, the permission rows still work. */
export const Disabled: Story = {
  decorators: [seed({ computerUseEnabled: false, computerUseAlwaysAllowApps: [] })],
}

/** Nothing always-allowed yet — the card explains how apps get here. */
export const NoAlwaysAllowApps: Story = {
  decorators: [seed({ computerUseAlwaysAllowApps: [] })],
}

/** Allow All hides the per-app list entirely. */
export const AllowAllApps: Story = {
  decorators: [seed({ computerUseAllowAllApps: true })],
}

/** Grants missing: each permission gets its own Request button. */
export const PermissionsMissing: Story = {
  decorators: [seed({}, { ...GRANTED, accessibility: 'missing', screenRecording: 'missing', reason: undefined })],
}

/** Permission status still loading. */
export const CheckingPermissions: Story = {
  decorators: [seed({}, 'pending')],
}

export const Dark: Story = {
  decorators: [seed({}, { ...GRANTED, screenRecording: 'missing', reason: undefined })],
  globals: { theme: 'dark' },
}

/** Long app names, bundle ids and helper paths truncate; controls keep their width. */
export const Narrow: Story = {
  decorators: [
    seed({
      computerUseAlwaysAllowApps: [
        { app: 'Microsoft Visual Studio Code — Insiders Edition', bundleId: 'com.microsoft.VSCodeInsiders.helper.renderer' },
        { app: 'Preview', bundleId: 'com.apple.Preview' },
      ],
    }),
    (Story) => (
      <div className="w-[420px]">
        <Story />
      </div>
    ),
  ],
}
