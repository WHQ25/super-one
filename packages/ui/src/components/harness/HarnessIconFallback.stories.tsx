import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ComponentType } from 'react'
import { AcpSessionIcon } from './AcpSessionIcon'
import { ClaudeSessionIcon, type SessionIconProps } from './ClaudeSessionIcon'
import { CodexSessionIcon } from './CodexSessionIcon'
import { GrokSessionIcon } from './GrokSessionIcon'
import { OpenCodeSessionIcon } from './OpenCodeSessionIcon'

type Status = SessionIconProps['status']

const STATUSES: Status[] = ['default', 'running', 'background', 'unseen', 'automation']

const FALLBACK_HARNESSES: { name: string; Icon: ComponentType<SessionIconProps> }[] = [
  { name: 'Grok', Icon: GrokSessionIcon },
  { name: 'OpenCode', Icon: OpenCodeSessionIcon },
  { name: 'ACP', Icon: AcpSessionIcon },
]

const ALL_HARNESSES: { name: string; Icon: ComponentType<SessionIconProps>; note: string }[] = [
  { name: 'Grok', Icon: GrokSessionIcon, note: 'fallback' },
  { name: 'OpenCode', Icon: OpenCodeSessionIcon, note: 'fallback' },
  { name: 'ACP', Icon: AcpSessionIcon, note: 'fallback' },
  { name: 'Claude', Icon: ClaudeSessionIcon, note: 'custom' },
  { name: 'Codex', Icon: CodexSessionIcon, note: 'custom' },
]

const STATUS_HINT: Record<Status, string> = {
  default: 'static mark',
  running: 'scale pulse',
  background: 'opacity breathe',
  unseen: 'check badge',
  automation: 'clock badge',
}

function Cell({
  Icon,
  status,
  size,
  renderLevel,
}: {
  Icon: ComponentType<SessionIconProps>
  status: Status
  size: number
  renderLevel: SessionIconProps['renderLevel']
}) {
  return (
    <div className="bg-muted/40 flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg p-3">
      <Icon status={status} size={size} renderLevel={renderLevel} />
      <span className="text-muted-foreground text-center text-[11px] leading-tight">
        {STATUS_HINT[status]}
      </span>
    </div>
  )
}

const meta: Meta = {
  title: 'Harness/Session icons',
  parameters: {
    layout: 'padded',
  },
  argTypes: {
    size: {
      control: { type: 'range', min: 12, max: 48, step: 1 },
    },
    renderLevel: {
      control: 'inline-radio',
      options: ['compact', 'rich'],
    },
  },
  args: {
    size: 22,
    renderLevel: 'compact',
  },
}

export default meta
type Story = StoryObj<typeof meta>

/** Fallback-only grid: Grok / OpenCode / ACP × all statuses. */
export const FallbackMatrix: Story = {
  name: 'Fallback matrix',
  render: (args) => {
    const size = Number(args.size ?? 22)
    const renderLevel = (args.renderLevel ?? 'compact') as SessionIconProps['renderLevel']
    return (
      <div className="bg-background text-foreground space-y-4 p-2">
        <p className="text-muted-foreground text-sm">
          Static mark + shared status chrome. Use the toolbar Theme toggle for dark mode.
        </p>
        <div
          className="grid items-center gap-2"
          style={{ gridTemplateColumns: `88px repeat(${STATUSES.length}, minmax(0, 1fr))` }}
        >
          <div />
          {STATUSES.map((status) => (
            <div key={status} className="text-muted-foreground text-center text-xs">
              {status}
            </div>
          ))}
          {FALLBACK_HARNESSES.map(({ name, Icon }) => (
            <div key={name} className="contents">
              <div className="text-sm font-medium">{name}</div>
              {STATUSES.map((status) => (
                <Cell
                  key={status}
                  Icon={Icon}
                  status={status}
                  size={size}
                  renderLevel={renderLevel}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  },
}

/** Sidebar-scale strip — closer to SessionRow density. */
export const SidebarSizes: Story = {
  name: 'Sidebar sizes',
  args: { size: 14, renderLevel: 'compact' },
  render: (args) => {
    const size = Number(args.size ?? 14)
    const renderLevel = (args.renderLevel ?? 'compact') as SessionIconProps['renderLevel']
    return (
      <div className="bg-background text-foreground space-y-6 p-2">
        {FALLBACK_HARNESSES.map(({ name, Icon }) => (
          <div key={name} className="space-y-2">
            <div className="text-sm font-medium">{name}</div>
            <div className="bg-sidebar border-border flex flex-wrap items-center gap-4 rounded-lg border p-3">
              {STATUSES.map((status) => (
                <div key={status} className="flex items-center gap-2">
                  <Icon status={status} size={size} renderLevel={renderLevel} />
                  <span className="text-muted-foreground text-xs">{status}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  },
}

/** Fallback vs Claude/Codex custom art. */
export const AllHarnesses: Story = {
  name: 'All harnesses',
  render: (args) => {
    const size = Number(args.size ?? 22)
    const renderLevel = (args.renderLevel ?? 'compact') as SessionIconProps['renderLevel']
    return (
      <div className="bg-background text-foreground space-y-4 p-2">
        <div
          className="grid items-center gap-2"
          style={{ gridTemplateColumns: `100px repeat(${STATUSES.length}, minmax(0, 1fr))` }}
        >
          <div />
          {STATUSES.map((status) => (
            <div key={status} className="text-muted-foreground text-center text-xs">
              {status}
            </div>
          ))}
          {ALL_HARNESSES.map(({ name, Icon, note }) => (
            <div key={name} className="contents">
              <div>
                <div className="text-sm font-medium">{name}</div>
                <div className="text-muted-foreground text-[11px]">{note}</div>
              </div>
              {STATUSES.map((status) => (
                <Cell
                  key={status}
                  Icon={Icon}
                  status={status}
                  size={size}
                  renderLevel={renderLevel}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  },
}
