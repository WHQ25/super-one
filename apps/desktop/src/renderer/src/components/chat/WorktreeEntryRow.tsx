import { useState } from 'react'
import { GitBranch, GitCommit, Check } from 'lucide-react'
import { MarqueeText } from '@superone/ui/components/ui/marquee-text'
import type { GitDirtyStatus } from '@superone/shared/agent-types'
import { DiffStat } from './DiffStat'

interface WorktreeEntryRowProps {
  label: string
  detached: boolean
  /** Undefined while the dirty status is still loading. */
  dirty: GitDirtyStatus | undefined
  isCurrent: boolean
  onClick: () => void
}

/**
 * One row in the "existing worktrees" list. Always two lines tall so rows line
 * up: the branch stays on one line (scrolling on hover when it overflows) and
 * the status line reads `clean` instead of disappearing.
 */
export function WorktreeEntryRow({ label, detached, dirty, isCurrent, onClick }: WorktreeEntryRowProps) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex w-full items-start gap-2 px-3 py-1.5 text-xs hover:bg-accent"
    >
      {detached ? <GitCommit className="mt-0.5 size-3 shrink-0 text-muted-foreground" /> : <GitBranch className="mt-0.5 size-3 shrink-0 text-muted-foreground" />}
      <div className="flex min-w-0 flex-1 flex-col items-stretch text-left">
        <MarqueeText hovered={hovered} className={detached ? 'text-muted-foreground' : undefined}>
          {label}
        </MarqueeText>
        <span className="text-xs text-muted-foreground">
          {!dirty ? ' ' : dirty.files > 0 ? <span className="text-amber-500"><DiffStat stat={dirty} /></span> : 'clean'}
        </span>
      </div>
      {isCurrent && <Check className="mt-0.5 size-3 shrink-0 text-primary" />}
    </button>
  )
}
