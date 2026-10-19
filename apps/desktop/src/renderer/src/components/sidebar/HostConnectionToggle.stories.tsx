import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { RotateCw } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { HostConnectionToggle } from './HostConnectionToggle'

function HeaderRow({
  connected: initialConnected,
  busy = false,
  spinning = false,
  narrow = false,
  dark = false,
  label = 'Studio Mac',
}: {
  connected: boolean
  busy?: boolean
  spinning?: boolean
  narrow?: boolean
  dark?: boolean
  label?: string
}) {
  const [connected, setConnected] = useState(initialConnected)

  return (
    <div className={cn(dark && 'dark')}>
      <div
        className="flex items-center justify-between bg-sidebar px-1.5 py-1 text-sidebar-foreground"
        style={{ width: narrow ? 220 : 288 }}
      >
        <span className="min-w-0 truncate px-1.5 text-sm font-medium text-sidebar-foreground/70">
          {label}
        </span>
        <div className="flex items-center gap-0.5">
          <IconButton size="sm" tooltip="Refresh" disabled={!connected || busy}>
            <RotateCw className="size-3" />
          </IconButton>
          <HostConnectionToggle
            connected={busy ? initialConnected : connected}
            busy={busy}
            spinning={spinning}
            onToggle={() => {
              if (busy) return
              setConnected((value) => !value)
            }}
          />
        </div>
      </div>
    </div>
  )
}

const meta = {
  title: 'Sidebar/HostConnectionToggle',
  component: HeaderRow,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof HeaderRow>

export default meta
type Story = StoryObj<typeof meta>

export const Connected: Story = {
  args: { connected: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const power = canvas.getByRole('button', { name: 'Disconnect', pressed: true })
    await expect(power).toHaveClass('text-success')
    await userEvent.click(power)
    await expect(canvas.getByRole('button', { name: 'Connect', pressed: false })).toHaveClass('text-destructive')
  },
}

export const Disconnected: Story = {
  args: { connected: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const power = canvas.getByRole('button', { name: 'Connect', pressed: false })
    await expect(power).toHaveClass('text-destructive')
    await userEvent.click(power)
    await expect(canvas.getByRole('button', { name: 'Disconnect', pressed: true })).toHaveClass('text-success')
  },
}

export const Busy: Story = {
  args: { connected: true, busy: true },
  play: async ({ canvasElement }) => {
    const power = within(canvasElement).getByRole('button', { name: 'Disconnect' })
    await expect(power).toBeDisabled()
    await expect(power).toHaveClass('text-success')
    await expect(power.querySelector('.lucide-loader-circle')).not.toBeNull()
  },
}

export const Connecting: Story = {
  args: { connected: true, spinning: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const power = canvas.getByRole('button', { name: 'Disconnect', pressed: true })
    await expect(power).toBeEnabled()
    await expect(power).toHaveClass('text-success')
    await expect(power.querySelector('.lucide-loader-circle')).not.toBeNull()
    await userEvent.click(power)
    await expect(canvas.getByRole('button', { name: 'Connect', pressed: false })).toBeVisible()
  },
}

export const NarrowLongName: Story = {
  args: {
    connected: true,
    narrow: true,
    label: "Hangqi's Studio MacBook Pro with a very long device name",
  },
}

export const Dark: Story = {
  args: { connected: true, dark: true },
}
