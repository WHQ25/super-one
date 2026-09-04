import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

export interface CollapsibleOutputPresenterProps {
  text: string
  collapsedLabel: string
  expandedLabel: string
}

/** Collapsible terminal output block. Always collapsed by default with expand/collapse toggle. */
export function CollapsibleOutputPresenter({
  text,
  collapsedLabel,
  expandedLabel,
}: CollapsibleOutputPresenterProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="my-1">
      {expanded && (
        <div className="overflow-x-auto rounded bg-background/70 px-2 py-1.5 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
          {text}
        </div>
      )}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight
          className={cn('size-3 shrink-0 transition-transform', expanded && 'rotate-90')}
        />
        {expanded ? expandedLabel : collapsedLabel}
      </button>
    </div>
  )
}
