import type { Meta, StoryObj } from '@storybook/react-vite'
import { Kbd } from './kbd'

const meta: Meta<typeof Kbd> = {
  title: 'UI/Kbd',
  component: Kbd,
  argTypes: {
    variant: { control: 'select', options: ['badge', 'inline', 'square'] },
  },
  args: { variant: 'badge', children: '⌘K' },
}

export default meta
type Story = StoryObj<typeof Kbd>

export const Default: Story = {}

export const Variants: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Kbd variant="badge">⌘K</Kbd>
      <Kbd variant="square">↵</Kbd>
      <Kbd variant="inline">Esc</Kbd>
    </div>
  ),
}

export const OnSurfaces: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div className="bg-background text-foreground min-h-screen space-y-4 p-8">
      <p className="text-muted-foreground text-sm">
        The kbd chip fill uses <code>bg-muted</code> (an inset surface token), not the page base.
        Sweep the hue dial — it should track the surface temperature, never lock to a fixed color.
      </p>
      <div className="flex items-center gap-2 text-sm">
        Press <Kbd>⌘</Kbd> <Kbd>⇧</Kbd> <Kbd>P</Kbd> to open the palette
      </div>
      <div className="bg-card text-card-foreground border-border flex items-center gap-2 rounded-lg border p-4 text-sm">
        Inside a card: submit with <Kbd variant="square">↵</Kbd>
      </div>
    </div>
  ),
}
