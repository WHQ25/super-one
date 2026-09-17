import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactElement } from 'react'
import type { UpdateEvent } from '@superone/shared/agent-types'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { useAppStore } from '@/stores/app'
import { IdentityMigrationDialog } from './IdentityMigrationDialog'
import { UpdateStatusIcon } from './UpdateStatusIcon'

/**
 * The bridge build's dialog. The main process drives it through updater
 * events; here each story seeds the store the way one of those events would,
 * and the IPC actions replay the next stage so the flow can be clicked through
 * without a real download.
 */

mockIpc('app', 'migrationDownload', async () => {
  useAppStore.getState().handleUpdateEvent({ type: 'identity-migration', stage: 'downloading', version: '0.67.0', percent: 0 })
  for (const percent of [12, 41, 78, 99]) {
    await new Promise((r) => setTimeout(r, 350))
    useAppStore.getState().handleUpdateEvent({ type: 'identity-migration', stage: 'downloading', version: '0.67.0', percent })
  }
  useAppStore.getState().handleUpdateEvent({
    type: 'identity-migration',
    stage: 'downloaded',
    version: '0.67.0',
    path: '/Users/dev/Downloads/SuperOne-0.67.0-arm64.dmg',
  })
})
mockIpc('app', 'migrationOpenInstaller', async () => undefined)
mockIpc('app', 'migrationReveal', async () => undefined)

type MigrationEvent = Extract<UpdateEvent, { type: 'identity-migration' }>

function seed(event: MigrationEvent, { dismissed = false } = {}) {
  return (Story: () => ReactElement) => {
    useAppStore.setState({
      updateStatus: 'idle',
      updateVersion: null,
      updateProgress: 0,
      updateErrorMessage: null,
      migrationInstallerPath: null,
      migrationDialogOpen: false,
    })
    useAppStore.getState().handleUpdateEvent(event)
    if (dismissed) useAppStore.setState({ migrationDialogOpen: false })
    return (
      <div className="flex h-64 w-72 flex-col justify-end rounded-md border border-border bg-sidebar p-3">
        <div className="flex items-center text-xs text-muted-foreground">
          Sidebar footer
          <UpdateStatusIcon />
        </div>
        <Story />
      </div>
    )
  }
}

const meta: Meta<typeof IdentityMigrationDialog> = {
  title: 'Shell/IdentityMigrationDialog',
  component: IdentityMigrationDialog,
  parameters: { layout: 'centered' },
}
export default meta

type Story = StoryObj<typeof IdentityMigrationDialog>

/** First launch of the bridge: manifest not read yet, so no version on the button. */
export const Required: Story = {
  decorators: [seed({ type: 'identity-migration', stage: 'required', version: null })],
}

/** Manifest read: the button names the version. Click it to watch the mocked download. */
export const RequiredWithVersion: Story = {
  decorators: [seed({ type: 'identity-migration', stage: 'required', version: '0.67.0' })],
}

export const Downloading: Story = {
  decorators: [seed({ type: 'identity-migration', stage: 'downloading', version: '0.67.0', percent: 63 })],
}

export const Downloaded: Story = {
  decorators: [
    seed({ type: 'identity-migration', stage: 'downloaded', version: '0.67.0', path: '/Users/dev/Downloads/SuperOne-0.67.0-arm64.dmg' }),
  ],
}

export const DownloadFailed: Story = {
  decorators: [seed({ type: 'identity-migration', stage: 'error', version: '0.67.0', message: 'installer: HTTP 503' })],
}

/** After "Later": only the sidebar pill remains; clicking it reopens the dialog. */
export const DismissedPillOnly: Story = {
  decorators: [seed({ type: 'identity-migration', stage: 'required', version: '0.67.0' }, { dismissed: true })],
}
