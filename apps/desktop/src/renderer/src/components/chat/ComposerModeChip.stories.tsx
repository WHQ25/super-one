import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ClipboardList, Paperclip } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { ComposerModeChip } from './ComposerModeChip'
import { modes } from './PermissionModeList'
import { useToolbarChipCompact } from './composer-toolbar-compact'

const planMode = modes.find((mode) => mode.id === 'plan')!

interface PlanHarnessProps {
  width?: number
  modelLabel?: string
}

function PlanHarness({ width = 680, modelLabel = 'GPT6.2 Astra · High' }: PlanHarnessProps) {
  const [planActive, setPlanActive] = useState(true)
  const { toolbarRef, leftGroupRef, rightGroupRef, compact } = useToolbarChipCompact(planActive, 'plan')

  return (
    <div style={{ width }}>
      <div className="rounded-xl border border-border bg-background px-3 py-2">
        <div className="h-10 text-sm text-muted-foreground">Ask Codex anything…</div>
        <div ref={toolbarRef} className="mt-1.5 flex items-center justify-between gap-2 text-muted-foreground">
          <div ref={leftGroupRef} className="flex min-w-0 items-center gap-2">
            <IconButton size="sm"><Paperclip /></IconButton>
            <span className="shrink-0 whitespace-nowrap text-xs">{modelLabel}</span>
            {planActive && (
              <ComposerModeChip
                icon={ClipboardList}
                label="Plan"
                title="Exit plan mode"
                onExit={() => setPlanActive(false)}
                className={cn(planMode.color, planMode.hoverBg)}
                compact={compact}
              />
            )}
          </div>
          <div ref={rightGroupRef} className="flex shrink-0 items-center gap-1.5">
            <span className="size-4 rounded-full border-2 border-amber-500" />
            <span className="size-6 rounded-full border border-border" />
            <span className="size-6 rounded-full border border-border" />
          </div>
        </div>
      </div>
    </div>
  )
}

const meta: Meta<typeof PlanHarness> = {
  title: 'Tool UI/General/ComposerModeChip',
  component: PlanHarness,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof PlanHarness>

export const Default: Story = {}

export const NarrowToolbar: Story = {
  args: {
    width: 260,
    modelLabel: 'GPT6.2 Astra · High',
  },
}
