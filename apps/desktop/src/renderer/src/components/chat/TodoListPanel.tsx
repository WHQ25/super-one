import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { ListTodo, Circle, CircleDashed, CheckCircle2 } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

export interface TodoListPanelItem {
  id: string
  text: string
  status: 'pending' | 'in_progress' | 'completed'
}

interface TodoListPanelProps {
  items: TodoListPanelItem[]
  expanded?: boolean
  onToggle?: () => void
  trailing?: ReactNode
  className?: string
  listClassName?: string
}

export function TodoListPanel({
  items,
  expanded = true,
  onToggle,
  trailing,
  className,
  listClassName,
}: TodoListPanelProps) {
  const activeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (expanded && activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'center' })
    }
  }, [expanded, items])

  if (items.length === 0) return null

  const completed = items.filter((item) => item.status === 'completed').length

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
        <div className={cn('max-h-[100px] overflow-y-auto border-t border-border p-1', listClassName)}>
          {items.map((item) => (
            <div
              key={item.id}
              ref={item.status === 'in_progress' ? activeRef : undefined}
              className="flex items-start gap-2 rounded px-2 py-1 text-xs"
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
                {item.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
