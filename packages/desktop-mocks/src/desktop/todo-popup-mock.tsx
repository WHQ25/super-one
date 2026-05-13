"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { CheckCircle2, Circle, CircleDashed, ListTodo } from "lucide-react"
import { Kbd } from "@superone/ui/components/ui/kbd"
import { cn } from "@superone/ui/lib/utils"

export type TodoStatus = "pending" | "in_progress" | "completed"

export interface TodoPopupItem {
  id: string
  text: string
  status: TodoStatus
}

export interface TodoPopupMockProps {
  items: TodoPopupItem[]
  expanded?: boolean
  defaultExpanded?: boolean
  onToggle?: () => void
  trailing?: ReactNode
  showKbdHint?: boolean
  frame?: number
  fps?: number
  expandAtSec?: number
  className?: string
  listClassName?: string
  scrollIntoActive?: boolean
}

export function TodoPopupMock({
  items,
  expanded: expandedProp,
  defaultExpanded = true,
  onToggle,
  trailing,
  showKbdHint = true,
  frame,
  fps = 30,
  expandAtSec,
  className,
  listClassName,
  scrollIntoActive = false,
}: TodoPopupMockProps) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded)
  const activeRef = useRef<HTMLDivElement>(null)

  const isFrameDriven = frame !== undefined
  let resolvedExpanded: boolean
  if (expandedProp !== undefined) {
    resolvedExpanded = expandedProp
  } else if (isFrameDriven && expandAtSec !== undefined) {
    resolvedExpanded = frame! / fps >= expandAtSec
  } else {
    resolvedExpanded = internalExpanded
  }
  const isControlled = expandedProp !== undefined || (isFrameDriven && expandAtSec !== undefined)

  useEffect(() => {
    if (!scrollIntoActive) return
    if (resolvedExpanded && activeRef.current) {
      activeRef.current.scrollIntoView({ block: "center" })
    }
  }, [resolvedExpanded, items, scrollIntoActive])

  if (items.length === 0) return null

  const completed = items.filter((item) => item.status === "completed").length
  const hasInProgress = items.some((item) => item.status === "in_progress")
  const resolvedTrailing =
    trailing ?? (showKbdHint ? <Kbd className="ml-auto">{resolvedExpanded ? "esc" : "⌃T"}</Kbd> : null)

  const handleToggle = () => {
    if (onToggle) onToggle()
    else if (!isControlled) setInternalExpanded((v) => !v)
  }

  const interactive = !!onToggle || !isControlled

  return (
    <div
      className={cn(
        "mx-3 mb-1 flex shrink-0 flex-col overflow-hidden rounded-lg border border-border",
        className,
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-1.5 px-3 py-1.5",
          interactive && "cursor-pointer hover:bg-muted/30",
        )}
        onClick={interactive ? handleToggle : undefined}
      >
        <ListTodo className="size-3.5 shrink-0 text-muted-foreground" />
        <span
          className={cn(
            "text-xs font-medium text-muted-foreground",
            !resolvedExpanded && hasInProgress && "animate-pulse",
          )}
        >
          Todos ({completed}/{items.length})
        </span>
        {resolvedTrailing}
      </div>

      {resolvedExpanded && (
        <div className={cn("max-h-[100px] overflow-y-auto border-t border-border p-1", listClassName)}>
          {items.map((item) => (
            <div
              key={item.id}
              ref={item.status === "in_progress" ? activeRef : undefined}
              className="flex items-start gap-2 rounded px-2 py-1 text-xs"
            >
              {item.status === "completed" ? (
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-green-500" />
              ) : item.status === "in_progress" ? (
                <CircleDashed className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary [animation-duration:3s]" />
              ) : (
                <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span
                className={cn(
                  "min-w-0 flex-1 leading-snug",
                  item.status === "completed" && "text-muted-foreground line-through",
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
