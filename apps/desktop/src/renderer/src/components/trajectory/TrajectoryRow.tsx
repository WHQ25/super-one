import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  Bot,
  ChevronDown,
  ChevronRight,
  Boxes,
  FileInput,
  ShieldQuestion,
  Sliders,
  User,
  Wrench,
} from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import type { TrajectoryRecord } from '@superone/shared/trajectory-types'
import { formatDuration } from './trajectory-format'

/**
 * Kind is carried by an icon, never by a color.
 *
 * The palette already spends its hues on runtime state, so giving a record kind
 * a color of its own would make decoration indistinguishable from status at a
 * glance. Icons scan just as fast and stay semantically free — `text-destructive`
 * is then free to mean only what it means everywhere else: this call failed.
 */
const KIND_ICONS = {
  system: Sliders,
  user: User,
  context: FileInput,
  message: Bot,
  tool: Wrench,
  compacted: Archive,
  approval: ShieldQuestion,
  preset: Boxes,
} as const

export interface TrajectoryRowProps {
  record: TrajectoryRecord
  selected: boolean
  /** Whether this record's step has its tool calls folded away. */
  foldedCalls: boolean
  /** Present only on a message whose step actually made calls. */
  onToggleCalls?: () => void
  onSelect: () => void
}

/** One ledger record: index, kind, content, and its own duration. */
export const TrajectoryRow = memo(function TrajectoryRow({
  record,
  selected,
  foldedCalls,
  onToggleCalls,
  onSelect,
}: TrajectoryRowProps) {
  const { t } = useTranslation()
  const Icon = KIND_ICONS[record.kind]
  const failed = record.kind === 'tool' && record.isError

  return (
    <div className={cn('flex w-full items-center gap-1 pr-3 text-xs', selected && 'bg-accent')}>
      <span className="w-10 shrink-0 text-right font-mono text-[10px] text-muted-foreground/70">
        #{record.index}
      </span>

      {onToggleCalls
        ? (
          <IconButton
            size="xs"
            variant="nested"
            tooltip={t(foldedCalls ? 'trajectory.expandCalls' : 'trajectory.collapseCalls')}
            onClick={onToggleCalls}
          >
            {foldedCalls ? <ChevronRight /> : <ChevronDown />}
          </IconButton>
        )
        : <span className="size-5 shrink-0" />}

      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 py-1 text-left',
          // Tool calls sit under the message that requested them.
          record.kind === 'tool' && 'pl-4',
        )}
      >
        <Icon
          className={cn('size-3.5 shrink-0', failed ? 'text-destructive' : 'text-muted-foreground')}
          aria-hidden
        />
        <span className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {t(`trajectory.kind.${record.kind}`)}
        </span>
        <span className={cn('min-w-0 flex-1 truncate', failed && 'text-destructive')}>
          {record.summary}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
          {formatDuration(record.durationMs)}
        </span>
      </button>
    </div>
  )
})
