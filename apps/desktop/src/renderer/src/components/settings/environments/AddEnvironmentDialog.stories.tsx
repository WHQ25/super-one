import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import i18n from 'i18next'
import { AddEnvironmentDialog } from './AddEnvironmentDialog'
import { useAppStore } from '@/stores/app'

const meta = {
  title: 'Settings/Environments/Add Environment',
  component: AddEnvironmentDialog,
  args: { open: true, onOpenChange: fn(), onAdded: fn() },
  beforeEach: (context) => {
    const previous = useAppStore.getState().appVariant
    const previousApi = window.environment
    useAppStore.setState({ appVariant: context.parameters.variant ?? 'stable' })
    window.environment = { ...previousApi, listSshConfigHosts: async () => [], listItems: async () => [], onInstallProgress: () => () => {} }
    return () => { useAppStore.setState({ appVariant: previous }); window.environment = previousApi }
  },
  play: async ({ canvasElement, parameters }) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(screen.getByRole('button', { name: i18n.t('settings.environments.add.addNewHostTab') }))
    await userEvent.click(screen.getByRole('button', { name: i18n.t('settings.environments.add.advanced') }))
    await expect(screen.getByLabelText(i18n.t('settings.environments.add.remotePort'))).toHaveValue(parameters.variant === 'alpha' ? '7790' : '7788')
  },
} satisfies Meta<typeof AddEnvironmentDialog>
export default meta
type Story = StoryObj<typeof meta>
export const Stable: Story = {}
export const Alpha: Story = { parameters: { variant: 'alpha' } }
