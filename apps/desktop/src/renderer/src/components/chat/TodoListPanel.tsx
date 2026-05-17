import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ListTodo, Circle, CircleDashed, CheckCircle2, ChevronRight, Bot, Lock } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

export interface TodoListPanelItem {
  id: string
  text: string
  status: 'pending' | 'in_progress' | 'completed'
  description?: string
  owner?: string
  blockedBy?: string[]
}

interface TodoListPanelProps {
  items: TodoListPanelItem[]
  expanded?: boolean
  onToggle?: () => void
  trailing?: ReactNode
  className?: string
  listClassName?: string
  showItemIds?: boolean
}

export function TodoListPanel({
  items,
  expanded = true,
  onToggle,
  trailing,
  className,
  listClassName,
  showItemIds = true,
}: TodoListPanelProps) {
  const activeRef = useRef<HTMLDivElement>(null)
  const [openRows, setOpenRows] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (expanded && activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'center' })
    }
  }, [expanded, items])

  if (items.length === 0) return null

  const completed = items.filter((item) => item.status === 'completed').length

  const toggleRow = (id: string) =>
    setOpenRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className={cn('flex shrink-0 flex-col overflow-hidden', className)}>
      <div
        className={cn(
          'flex shrink-0 items-center gap-1.5 px-3 py-1.5',
          onToggle && 'cursor-pointer hover:bg-muted/30',
        )}
        onClick={onToggle}
      >
        <ListTodo className="size-3.5 shrink-0 text-muted-foreground" />
        <span className={cn('text-xs font-medium text-muted-foreground', !expanded && items.some((item) => item.status === 'in_progress') && 'animate-pulse')}>
          Todos ({completed}/{items.length})
        </span>
        {trailing}
      </div>

      {expanded && (
        <div className={cn('max-h-[140px] overflow-y-auto border-t border-border p-1', listClassName)}>
          {items.map((item) => {
            const blockers = item.blockedBy ?? []
            const autoDesc = item.status === 'in_progress' && item.description
            const detail = Boolean(item.description && !autoDesc)
            const isOpen = openRows.has(item.id)
            return (
              <div key={item.id} ref={item.status === 'in_progress' ? activeRef : undefined}>
                <div
                  className={cn(
                    'flex items-start gap-2 rounded px-2 py-1 text-xs',
                    detail && 'cursor-pointer hover:bg-muted/30',
                  )}
                  onClick={detail ? () => toggleRow(item.id) : undefined}
                >
                  {item.status === 'completed' ? (
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-green-500" />
                  ) : item.status === 'in_progress' ? (
                    <CircleDashed className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary [animation-duration:3s]" />
                  ) : (
                    <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span
                    className={cn(
                      'min-w-0 flex-1 leading-snug',
                      item.status === 'completed' && 'text-muted-foreground line-through',
                    )}
                  >
                    {showItemIds && <span className="mr-1 text-muted-foreground">#{item.id}</span>}
                    {item.text}
                    {item.owner && (
                      <span className="ml-2 inline-flex items-center gap-1 align-middle text-[11px] text-muted-foreground">
                        <Bot className="size-3 shrink-0" />
                        <span className="max-w-[110px] truncate">{item.owner}</span>
                      </span>
                    )}
                    {blockers.length > 0 && (
                      <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-px align-middle text-[10px] font-medium text-amber-700 dark:text-amber-400">
                        <Lock className="size-2.5" />
                        {blockers.map((b) => `#${b}`).join(' ')}
                      </span>
                    )}
                  </span>
                  {detail && (
                    <ChevronRight className={cn('mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
                  )}
                </div>

                {autoDesc && (
                  <div className="ml-[26px] border-l border-border pl-2 pb-1 pr-2 text-[11px] leading-relaxed text-muted-foreground">
                    {item.description}
                  </div>
                )}

                {detail && isOpen && (
                  <div className="ml-[26px] border-l border-border pl-2 pb-1 pr-2 text-[11px] leading-relaxed text-muted-foreground">
                    {item.description}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
