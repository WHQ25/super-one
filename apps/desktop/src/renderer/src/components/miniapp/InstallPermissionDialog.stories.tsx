import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { InstallPermissionDialog } from './InstallPermissionDialog'
import { useMiniAppStore } from '@/stores/miniapp'
import { useAppStore } from '@/stores/app'

const confirm = fn(async () => ({ entry: { id: 'notes', manifest: { appId: 'notes', name: 'Notes', main: 'index.js' }, installDir: '/demo/project/.superone/alpha/apps/notes' }, meta: { appId: 'notes', version: '1.0.0', installedAt: '', source: 'local' as const, integrityVerified: true }, upgraded: false }))
const meta = {
  title: 'Mini Apps/Install Permission Dialog',
  component: InstallPermissionDialog,
  args: { onInstalled: fn(), onError: fn() },
  beforeEach: () => {
    const app = useAppStore.getState()
    const previous = useMiniAppStore.getState()
    confirm.mockClear()
    useAppStore.setState({ currentFolder: '/demo/project', appVariant: 'alpha' })
    useMiniAppStore.setState({ pendingInstall: { tempDir: '/tmp/preview', manifest: { appId: 'notes', name: 'Notes', main: 'index.js' } }, confirmInstall: confirm, cancelInstall: fn() })
    return () => { useAppStore.setState(app); useMiniAppStore.setState(previous) }
  },
} satisfies Meta<typeof InstallPermissionDialog>
export default meta
type Story = StoryObj<typeof meta>
export const Personal: Story = {}
export const Project: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(screen.getByRole('button', { name: /Project/ }))
    await userEvent.click(screen.getByRole('button', { name: /Allow all permissions/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Install$/ }))
    await expect(confirm).toHaveBeenCalledWith('/demo/project', undefined)
  },
}
