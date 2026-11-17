import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, GitBranch } from 'lucide-react'
import { useScrollEdgeFade } from '@superone/ui/lib/use-scroll-edge-fade'

export interface GitBranchMenuProps {
  current: string | null
  currentDetail?: ReactNode
  local: string[]
  loading?: boolean
  /** Replaces the empty-list sentence. Null hides it, when search already offers create. */
  emptyLabel?: string | null
  onSelect: (branch: string) => void
  /** Trailing status for a branch row (e.g. its checkout source). */
  badge?: (branch: string) => ReactNode
  /** Source branches rendered in the same scroller as the local ones. */
  extra?: ReactNode
  /** Notes under the list, such as a source that cannot be read. */
  notice?: ReactNode
  /** Optional block under the list. */
  footer?: ReactNode
}

const rowClass = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:shadow-none'

export function GitBranchMenu({
  current,
  currentDetail = null,
  local,
  loading = false,
  emptyLabel,
  onSelect,
  badge,
  extra = null,
  notice = null,
  footer = null,
}: GitBranchMenuProps) {
  const { t } = useTranslation()
  const listFade = useScrollEdgeFade<HTMLDivElement>()
  const localRows = [
    ...(current ? [current] : []),
    ...local.filter((branch) => branch !== current),
  ]
  const empty = !loading && localRows.length === 0 && !extra

  return (
    <div>
      {/* Same cap as the existing-worktree list: five two-line rows, then scroll. */}
      <div ref={listFade} data-slot="workdir-branch-list" className="scroll-edge-fade-y max-h-55 overflow-y-auto overscroll-contain">
        {/* A refresh keeps the rows already shown, so the popover does not change height. */}
        {loading && localRows.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground">{t('common.loading')}</div>
        )}
        {empty && emptyLabel !== null && (
          <div className="px-3 py-2 text-xs text-muted-foreground">{emptyLabel ?? t('chat.git.noBranches')}</div>
        )}
        {localRows.map((branch) => {
          // A badge may be its own control, so it sits beside the row button, not inside it.
          const trailing = badge?.(branch)
          return (
            <div key={branch} className="flex items-center hover:bg-accent">
              <button type="button" className={`${rowClass} min-w-0 flex-1 hover:bg-transparent`} onClick={() => onSelect(branch)}>
                <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col text-left">
                  <span className="truncate">{branch}</span>
                  {branch === current && currentDetail}
                </span>
                {branch === current && <Check className="size-3 shrink-0 text-primary" />}
              </button>
              {trailing && <span className="flex shrink-0 items-center pr-3">{trailing}</span>}
            </div>
          )
        })}
        {extra}
      </div>
      {notice}
      {footer && <div className="border-t">{footer}</div>}
    </div>
  )
}
