import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { cn } from '@superone/ui/lib/utils'
import { scopeBadgeClass, type ScopeTone } from './scope-badge'

function ScopeBadge({ tone, children }: { tone: ScopeTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
        scopeBadgeClass(tone),
      )}
    >
      {children}
    </span>
  )
}

const meta: Meta = {
  title: 'Tokens/ScopeBadge',
}

export default meta
type Story = StoryObj

export const Tones: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div className="bg-background text-foreground min-h-screen space-y-4 p-8">
      <p className="text-muted-foreground max-w-prose text-sm">
        Scope badges route through <code>scopeBadgeClass()</code> instead of hardcoded palette colors.
        Only the <code>brand</code> tier tracks the hue dial; <code>user</code> / <code>project</code> /{' '}
        <code>minor</code> are neutral surface tiers and should stay put.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <ScopeBadge tone="brand">official</ScopeBadge>
        <ScopeBadge tone="user">user</ScopeBadge>
        <ScopeBadge tone="project">project</ScopeBadge>
        <ScopeBadge tone="minor">local</ScopeBadge>
      </div>
      <div className="bg-card border-border flex flex-wrap items-center gap-2 rounded-lg border p-4">
        <span className="text-card-foreground text-sm">On a card surface:</span>
        <ScopeBadge tone="brand">official</ScopeBadge>
        <ScopeBadge tone="user">user</ScopeBadge>
        <ScopeBadge tone="project">project</ScopeBadge>
        <ScopeBadge tone="minor">plugin</ScopeBadge>
      </div>
    </div>
  ),
}
