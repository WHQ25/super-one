import type { Meta, StoryObj } from '@storybook/react-vite'
import { ArrowRight, Plus } from 'lucide-react'
import { Button } from './button'

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
    },
    size: {
      control: 'select',
      options: ['default', 'xs', 'sm', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'],
    },
    disabled: { control: 'boolean' },
  },
  args: {
    children: 'Button',
    variant: 'default',
    size: 'default',
    disabled: false,
  },
}

export default meta
type Story = StoryObj<typeof Button>

export const Default: Story = {}

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
      <Button variant="destructive">Destructive</Button>
    </div>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="xs">Extra small</Button>
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" aria-label="Add">
        <Plus />
      </Button>
    </div>
  ),
}

export const WithIcon: Story = {
  args: {
    children: (
      <>
        Continue <ArrowRight />
      </>
    ),
  },
}

export const SurfaceShowcase: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div className="bg-background text-foreground min-h-screen space-y-6 p-8">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Surface tokens preview</h2>
        <p className="text-muted-foreground text-sm">
          Theme / Harness sit in the toolbar; the floating dial in the corner sweeps brand hue 0–360°.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="bg-card text-card-foreground border-border rounded-lg border p-4">
          <div className="text-xs uppercase tracking-wide opacity-60">Card</div>
          <div className="mt-2 text-sm">bg-card / text-card-foreground</div>
        </div>
        <div className="bg-popover text-popover-foreground border-border rounded-lg border p-4">
          <div className="text-xs uppercase tracking-wide opacity-60">Popover</div>
          <div className="mt-2 text-sm">bg-popover</div>
        </div>
        <div className="bg-secondary text-secondary-foreground rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide opacity-60">Secondary</div>
          <div className="mt-2 text-sm">bg-secondary</div>
        </div>
        <div className="bg-muted text-muted-foreground rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide opacity-60">Muted</div>
          <div className="mt-2 text-sm">bg-muted</div>
        </div>
        <div className="bg-accent text-accent-foreground rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide opacity-60">Accent</div>
          <div className="mt-2 text-sm">bg-accent</div>
        </div>
        <div className="bg-sidebar text-sidebar-foreground border-sidebar-border rounded-lg border p-4">
          <div className="text-xs uppercase tracking-wide opacity-60">Sidebar</div>
          <div className="mt-2 text-sm">bg-sidebar</div>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Buttons</h3>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
          <Button variant="destructive">Destructive</Button>
        </div>
      </section>
    </div>
  ),
}
