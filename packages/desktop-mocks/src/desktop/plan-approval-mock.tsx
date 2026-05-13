"use client"

import {
  Check,
  CheckCircle2,
  Circle,
  FastForward,
  PenLine,
  X,
  Zap,
} from "lucide-react"
import { Button } from "@superone/ui/components/ui/button"
import { Kbd } from "@superone/ui/components/ui/kbd"
import { cn } from "@superone/ui/lib/utils"
import { MockMarkdown } from "./mock-markdown"

export type PlanApprovalAction = "approve" | "reject" | "toggle"

export interface PlanApprovalMockProps {
  fileName?: string
  planContent: string
  allowedPrompts?: Array<{ tool: string; prompt: string }>
  switchAfterApproval?: boolean
  fastModeTarget?: "auto" | "acceptEdits"
  focusedAction?: PlanApprovalAction
  feedbackPlaceholder?: string
  className?: string
}

export function PlanApprovalMock({
  fileName,
  planContent,
  allowedPrompts = [],
  switchAfterApproval = false,
  fastModeTarget = "acceptEdits",
  focusedAction = "approve",
  feedbackPlaceholder = "Tell Claude what to change about the plan",
  className,
}: PlanApprovalMockProps) {
  const isAutoTarget = fastModeTarget === "auto"
  const approveBtn = switchAfterApproval
    ? {
        cls: isAutoTarget
          ? "bg-amber-600 hover:bg-amber-500"
          : "bg-purple-600 hover:bg-purple-500",
        icon: isAutoTarget ? <Zap className="size-3" /> : <FastForward className="size-3" />,
        label: isAutoTarget ? "Approve + auto" : "Approve + accept edits",
        kbdCls: isAutoTarget ? "text-amber-200/80" : "text-purple-200/80",
      }
    : {
        cls: "bg-green-600 hover:bg-green-500",
        icon: <Check className="size-3" />,
        label: "Approve plan",
        kbdCls: "text-green-200/80",
      }

  return (
    <div
      className={cn(
        "@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <PenLine className="size-4 text-blue-600 dark:text-blue-400" />
        <span className="text-sm font-medium text-foreground">Plan review</span>
        {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="p-4">
          <MockMarkdown text={planContent} />
        </div>
      </div>

      <div className="shrink-0 border-t border-border px-4 py-3 space-y-2">
        {allowedPrompts.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
              Requested permissions
            </div>
            <div className="flex flex-wrap gap-1.5">
              {allowedPrompts.map((p, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  <span className="font-medium">{p.tool}</span>
                  <span>{p.prompt}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className={cn(
              "h-7 cursor-pointer gap-1 px-3 text-xs text-white",
              approveBtn.cls,
              focusedAction === "approve" && "ring-2 ring-ring/60 ring-offset-1 ring-offset-background",
            )}
          >
            {approveBtn.icon}
            {approveBtn.label}
            <Kbd variant="inline" className={cn("ml-1", approveBtn.kbdCls)}>↵</Kbd>
          </Button>
          <Button
            size="sm"
            className={cn(
              "h-7 cursor-pointer gap-1 bg-red-700 px-3 text-xs text-white hover:bg-red-600",
              focusedAction === "reject" && "ring-2 ring-red-600/60 ring-offset-1 ring-offset-background",
            )}
          >
            <X className="size-3" />
            Reject
            <Kbd variant="inline" className="ml-1 text-red-200/80">esc</Kbd>
          </Button>
          <div className="relative flex flex-1 items-center">
            <div className="flex h-7 w-full items-center rounded bg-muted px-2 pr-12 text-xs text-muted-foreground">
              {feedbackPlaceholder}
            </div>
            <Kbd className="pointer-events-none absolute right-2">⇥</Kbd>
          </div>
        </div>

        <button
          type="button"
          className={cn(
            "flex h-7 w-full cursor-pointer items-center gap-1.5 rounded border px-2.5 text-[11px] transition-colors",
            switchAfterApproval
              ? isAutoTarget
                ? "border-amber-500/50 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-500"
                : "border-purple-500/50 bg-purple-500/10 text-purple-500 hover:bg-purple-500/20"
              : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            focusedAction === "toggle" && "ring-2 ring-ring/60 ring-offset-1 ring-offset-background",
          )}
        >
          {switchAfterApproval ? (
            <CheckCircle2
              className={cn(
                "size-3.5 shrink-0",
                isAutoTarget ? "text-amber-600 dark:text-amber-400" : "text-purple-600 dark:text-purple-400",
              )}
            />
          ) : (
            <Circle className="size-3.5 shrink-0 text-muted-foreground/40" />
          )}
          <span className="flex min-w-0 items-center gap-1">
            <span>Switch to</span>
            <span
              className={cn(
                "inline-flex items-center gap-0.5 font-medium",
                isAutoTarget ? "text-amber-600 dark:text-amber-400" : "text-purple-600 dark:text-purple-400",
              )}
            >
              {isAutoTarget ? <Zap className="size-3" /> : <FastForward className="size-3" />}
              {isAutoTarget ? "Auto" : "Accept edits"}
            </span>
            <span>after approval</span>
          </span>
          <Kbd variant="square" className="ml-auto">1</Kbd>
        </button>
      </div>
    </div>
  )
}

