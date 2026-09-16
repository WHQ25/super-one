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
import { useMockT } from "./i18n"
import { PermissionFeedbackInputMock } from "./permission-action-bar-mock"

export type PlanApprovalAction = "approve" | "reject" | "toggle"

export interface PlanApprovalMockProps {
  fileName?: string
  planContent: string
  allowedPrompts?: Array<{ tool: string; prompt: string }>
  switchAfterApproval?: boolean
  fastModeTarget?: "auto" | "acceptEdits"
  focusedAction?: PlanApprovalAction
  /** Defaults to the desktop's "Reject feedback (optional, Enter to submit)". */
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
  feedbackPlaceholder,
  className,
}: PlanApprovalMockProps) {
  const t = useMockT()
  const isAutoTarget = fastModeTarget === "auto"
  // Mode identity colours stay bare palette steps, as on the desktop; the plain
  // approve/reject pair is the semantic success/destructive pair.
  const approveBtn = switchAfterApproval
    ? {
        cls: isAutoTarget
          ? "bg-amber-600 text-white hover:bg-amber-500"
          : "bg-purple-600 text-white hover:bg-purple-500",
        icon: isAutoTarget ? <Zap className="size-3" /> : <FastForward className="size-3" />,
        label: t(isAutoTarget ? "chat.plan.approveAuto" : "chat.plan.approveAccept"),
        kbdCls: isAutoTarget ? "text-amber-200/80" : "text-purple-200/80",
        ring: isAutoTarget ? "ring-amber-500" : "ring-purple-500",
      }
    : {
        cls: "bg-success text-success-foreground hover:bg-success/90",
        icon: <Check className="size-3" />,
        label: t("chat.plan.approve"),
        kbdCls: "text-success-foreground/70",
        ring: "ring-success",
      }

  return (
    <div
      className={cn(
        "@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <PenLine className="size-4 text-primary" />
        <span className="text-sm font-medium text-foreground">{t("chat.plan.review")}</span>
        {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
        <span className="ml-auto text-xs text-muted-foreground">{t("chat.plan.commentHint")}</span>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="p-4">
          <MockMarkdown text={planContent} />
        </div>
      </div>

      <div className="shrink-0 border-t border-border px-4 py-3 space-y-2">
        {allowedPrompts.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">
              {t("chat.plan.requestedPermissions")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {allowedPrompts.map((p, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
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
              "h-7 cursor-pointer gap-1 px-3 text-xs",
              approveBtn.cls,
              focusedAction === "approve" && cn("ring-2", approveBtn.ring),
            )}
          >
            {approveBtn.icon}
            {approveBtn.label}
            <Kbd variant="inline" className={cn("ml-1", approveBtn.kbdCls)}>↵</Kbd>
          </Button>
          <Button
            size="sm"
            className={cn(
              "h-7 cursor-pointer gap-1 bg-destructive px-3 text-xs text-destructive-foreground hover:bg-destructive/90",
              focusedAction === "reject" && "ring-2 ring-destructive",
            )}
          >
            <X className="size-3" />
            {t("chat.plan.reject")}
            <Kbd variant="inline" className="ml-1 text-destructive-foreground/70">esc</Kbd>
          </Button>
          <PermissionFeedbackInputMock placeholder={feedbackPlaceholder ?? t("chat.plan.feedbackPlaceholder")} />
        </div>

        <button
          type="button"
          className={cn(
            "flex h-7 w-full cursor-pointer items-center gap-1.5 rounded border px-2.5 text-xs transition-colors",
            switchAfterApproval
              ? isAutoTarget
                ? "border-amber-500/50 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-500"
                : "border-purple-500/50 bg-purple-500/10 text-purple-600 hover:bg-purple-500/20 dark:text-purple-400"
              : isAutoTarget
                ? "border-border text-muted-foreground hover:bg-amber-500/10"
                : "border-border text-muted-foreground hover:bg-purple-500/10",
            focusedAction === "toggle" && "ring-2 ring-ring",
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
            <span>{t("chat.plan.switchTo")}</span>
            <span
              className={cn(
                "inline-flex items-center gap-0.5 font-medium",
                isAutoTarget ? "text-amber-600 dark:text-amber-400" : "text-purple-600 dark:text-purple-400",
              )}
            >
              {isAutoTarget ? <Zap className="size-3" /> : <FastForward className="size-3" />}
              {isAutoTarget ? t("chat.plan.auto") : t("chat.plan.acceptEdits")}
            </span>
            <span>{t("chat.plan.afterApproval")}</span>
          </span>
          <Kbd variant="square" className="ml-auto">1</Kbd>
        </button>
      </div>
    </div>
  )
}

