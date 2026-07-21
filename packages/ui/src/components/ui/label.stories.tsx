import type { Meta, StoryObj } from '@storybook/react-vite'
import { Label } from './label'
import { Switch } from './switch'
import { Input } from './input'

const meta: Meta<typeof Label> = {
  title: 'UI/Label',
  component: Label,
  args: { children: 'Label' },
}

export default meta
type Story = StoryObj<typeof Label>

export const Default: Story = {}

export const WithSwitch: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Switch id="story-label-switch" />
      <Label htmlFor="story-label-switch">Enable feature</Label>
    </div>
  ),
}

export const WithInput: Story = {
  render: () => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="story-label-input">Display name</Label>
      <Input id="story-label-input" placeholder="e.g. Ada Lovelace" />
    </div>
  ),
}

export const Disabled: Story = {
  render: () => (
    <div className="group flex items-center gap-2" data-disabled="true">
      <Switch id="story-label-disabled" disabled />
      <Label htmlFor="story-label-disabled">Disabled setting</Label>
    </div>
  ),
}
