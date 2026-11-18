import type { Meta, StoryObj } from '@storybook/react-vite'
import { ChevronLeft, ChevronRight, Download, Pencil, X } from 'lucide-react'
import { IconButton } from './icon-button'

const meta: Meta<typeof IconButton> = {
  title: 'UI/IconButton',
  component: IconButton,
  argTypes: {
    variant: { control: 'select', options: ['default', 'ghost', 'destructive', 'nested', 'overlay'] },
    size: { control: 'select', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
  },
  args: { variant: 'default', size: 'md', tooltip: 'Edit', children: <Pencil /> },
}

export default meta
type Story = StoryObj<typeof IconButton>

export const Default: Story = {}

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map(size => (
        <IconButton key={size} {...args} size={size} tooltip={size}><Pencil /></IconButton>
      ))}
    </div>
  ),
}

/** Round translucent controls floating over media: viewer corners and carousel arrows. */
export const OverlayOnMedia: Story = {
  render: () => (
    <div className="relative h-56 w-96 overflow-hidden rounded-lg bg-[linear-gradient(135deg,#1d9e75,#534ab7)]">
      <div className="absolute top-3 right-3 flex gap-3">
        <IconButton variant="overlay" size="xl" tooltip="Download"><Download /></IconButton>
        <IconButton variant="overlay" size="xl" tooltip="Close"><X /></IconButton>
      </div>
      <IconButton variant="overlay" size="lg" tooltip="Previous" disabled className="absolute top-1/2 left-2 -translate-y-1/2 disabled:opacity-30">
        <ChevronLeft />
      </IconButton>
      <IconButton variant="overlay" size="lg" tooltip="Next" className="absolute top-1/2 right-2 -translate-y-1/2">
        <ChevronRight />
      </IconButton>
    </div>
  ),
}
