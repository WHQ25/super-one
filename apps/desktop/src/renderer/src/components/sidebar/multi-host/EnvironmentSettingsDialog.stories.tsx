import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { EnvironmentSettingsDialog } from './EnvironmentSettingsDialog'

const meta = {
  title: 'Sidebar/EnvironmentSettingsDialog',
  component: EnvironmentSettingsDialog,
  parameters: { layout: 'centered' },
  args: {
    open: true,
    name: 'dev-server',
    onOpenChange: () => {},
    onSubmit: async () => {},
  },
} satisfies Meta<typeof EnvironmentSettingsDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Rename: Story = {
  play: async () => {
    const body = within(document.body)
    await expect(body.getByRole('dialog')).toBeInTheDocument()
    await expect(body.getByRole('textbox', { name: 'Display Name' })).toHaveValue('dev-server')
    await expect(body.queryByText('The name this computer shows for this environment.')).not.toBeInTheDocument()
  },
}

export const EmptyName: Story = {
  play: async () => {
    const body = within(document.body)
    const input = body.getByRole('textbox', { name: 'Display Name' })
    await userEvent.clear(input)
    await expect(body.getByRole('button', { name: 'Save' })).toBeDisabled()
  },
}

export const LongName: Story = {
  args: { name: 'studio-macbook-pro-16-inch-in-the-other-room' },
}

export const Saving: Story = {
  args: {
    onSubmit: () => new Promise(() => {}),
  },
  play: async () => {
    const body = within(document.body)
    const input = body.getByRole('textbox', { name: 'Display Name' })
    await userEvent.clear(input)
    await userEvent.type(input, 'studio')
    await userEvent.click(body.getByRole('button', { name: 'Save' }))
    await expect(body.getByRole('button', { name: 'Saving...' })).toBeDisabled()
  },
}

export const Dark: Story = {
  globals: { theme: 'dark' },
}
