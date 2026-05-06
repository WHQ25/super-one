import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { CollapsedChatPanelView, COLLAPSED_SIZE, COLLAPSED_PENDING_MAX_W } from './CollapsedChatPanelView'

interface PanelFrameProps {
  pendingReason: string | null
  children: ReactNode
}

function PanelFrame({ pendingReason, children }: PanelFrameProps) {
  return (
    <div
      className="overflow-hidden border border-border bg-card shadow-2xl transition-[min-width,max-width] duration-200 ease-out"
      style={{
        width: 'auto',
        minWidth: COLLAPSED_SIZE,
        maxWidth: pendingReason ? COLLAPSED_PENDING_MAX_W : COLLAPSED_SIZE,
        height: COLLAPSED_SIZE,
        borderRadius: COLLAPSED_SIZE / 2,
      }}
    >
      {children}
    </div>
  )
}

interface DemoProps {
  pendingReason?: string | null
  isRunning?: boolean
  isUnseen?: boolean
}

function Demo({ pendingReason = null, isRunning = false, isUnseen = false }: DemoProps) {
  return (
    <PanelFrame pendingReason={pendingReason}>
      <CollapsedChatPanelView
        pendingReason={pendingReason}
        isRunning={isRunning}
        isUnseen={isUnseen}
      />
    </PanelFrame>
  )
}

const meta: Meta<typeof Demo> = {
  title: 'Common/CollapsedChatPanel',
  component: Demo,
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof Demo>

export const Idle: Story = {
  name: 'Idle (robot)',
  args: {},
}

export const Running: Story = {
  name: 'Running / background (robot breathing)',
  args: { isRunning: true },
}

export const TaskDone: Story = {
  name: 'Task done (check)',
  args: { isUnseen: true },
}

export const PendingPermissionWrite: Story = {
  name: 'Pending — Allow Write?',
  args: { isRunning: true, pendingReason: 'Allow Write?' },
}

export const PendingPermissionBash: Story = {
  name: 'Pending — Allow Bash?',
  args: { isRunning: true, pendingReason: 'Allow Bash?' },
}

export const PendingPlanReview: Story = {
  name: 'Pending — Review plan',
  args: { isRunning: true, pendingReason: 'Review plan' },
}

export const PendingQuestion: Story = {
  name: 'Pending — Question',
  args: { isRunning: true, pendingReason: 'Which file should I edit first?' },
}

export const PendingLongQuestion: Story = {
  name: 'Pending — Long text truncates',
  args: {
    isRunning: true,
    pendingReason: 'I need to know whether you prefer the workspace-level or user-level config for this setting',
  },
}

export const PendingWhileIdle: Story = {
  name: 'Pending while idle (no breathing)',
  args: { pendingReason: 'Waiting for input' },
}

export const Gallery: Story = {
  name: 'All states (gallery)',
  render: () => (
    <div className="flex flex-col gap-6 p-6">
      <Row label="Idle">
        <Demo />
      </Row>
      <Row label="Running (breathing)">
        <Demo isRunning />
      </Row>
      <Row label="Task done (check)">
        <Demo isUnseen />
      </Row>
      <Row label="Pending: Allow Write?">
        <Demo isRunning pendingReason="Allow Write?" />
      </Row>
      <Row label="Pending: Review plan">
        <Demo isRunning pendingReason="Review plan" />
      </Row>
      <Row label="Pending: long question (truncated)">
        <Demo
          isRunning
          pendingReason="I need to know whether you prefer the workspace-level or user-level config for this setting"
        />
      </Row>
    </div>
  ),
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-6">
      <div className="w-64 shrink-0 text-xs text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}
