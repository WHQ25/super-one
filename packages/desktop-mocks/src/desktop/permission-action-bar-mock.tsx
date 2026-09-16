"use client"

import type { ReactNode } from "react"
import { Button } from "@superone/ui/components/ui/button"
import { Kbd } from "@superone/ui/components/ui/kbd"
import { cn } from "@superone/ui/lib/utils"
import { useMockT } from "./i18n"

/**
 * Static twin of the desktop's `PermissionActionBar`: the approve / reject /
 * feedback vocabulary every "may I?" prompt shares. Tones are semantic tokens —
 * `approve` is the success pair, `reject` the destructive pair, `primary` the
 * brand-coloured "and remember it" escalation.
 */
export type PermissionActionTone = "approve" | "reject" | "primary" | "neutral"

const TONE_CLASS: Record<PermissionActionTone, string> = {
  approve: "bg-success text-success-foreground hover:bg-success/90",
  reject: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  neutral: "border border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground",
}

const TONE_KBD_CLASS: Record<PermissionActionTone, string> = {
  approve: "text-success-foreground/70",
  reject: "text-destructive-foreground/70",
  primary: "text-primary-foreground/80",
  neutral: "text-muted-foreground",
}

/** Keyboard focus is simulated: the real button paints the same ring via `focus:ring-2`. */
const TONE_RING_CLASS: Record<PermissionActionTone, string> = {
  approve: "ring-success",
  reject: "ring-destructive",
  primary: "ring-ring",
  neutral: "ring-ring",
}

export interface PermissionActionButtonMockProps {
  tone: PermissionActionTone
  children: ReactNode
  kbd?: ReactNode
  focused?: boolean
  disabled?: boolean
  className?: string
}

export function PermissionActionButtonMock({
  tone,
  children,
  kbd,
  focused = false,
  disabled = false,
  className,
}: PermissionActionButtonMockProps) {
  return (
    <Button
      size="sm"
      disabled={disabled}
      className={cn(
        "h-7 cursor-pointer px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50",
        TONE_CLASS[tone],
        focused && cn("ring-2", TONE_RING_CLASS[tone]),
        className,
      )}
    >
      {children}
      {kbd !== undefined && (
        <Kbd variant="inline" className={cn("ml-1", TONE_KBD_CLASS[tone])}>
          {kbd}
        </Kbd>
      )}
    </Button>
  )
}

export interface PermissionFeedbackInputMockProps {
  placeholder: string
  value?: string
  focused?: boolean
}

/** The optional reason box. Enter submits a rejection, so the trailing hint flips to ↵ on focus. */
export function PermissionFeedbackInputMock({
  placeholder,
  value,
  focused = false,
}: PermissionFeedbackInputMockProps) {
  return (
    <div className="relative flex min-w-0 basis-full items-center @lg:basis-0 @lg:flex-1">
      <div
        className={cn(
          "flex h-7 w-full items-center truncate rounded bg-muted px-2 pr-12 text-xs",
          value ? "text-foreground" : "text-muted-foreground",
          focused && "ring-1 ring-ring",
        )}
      >
        {value || placeholder}
      </div>
      <Kbd className="pointer-events-none absolute right-2">{focused ? "↵" : "⇥"}</Kbd>
    </div>
  )
}

export interface ApproveRejectBarMockProps {
  approveLabel?: string
  rejectLabel?: string
  /** Extra content inside the approve button, e.g. a selected-suggestion count. */
  approveSuffix?: ReactNode
  /** Buttons between approve and reject — the "and remember it" escalation. */
  extraActions?: ReactNode
  focused?: "approve" | "reject" | "feedback" | null
  /** Omit to hide the reason box. */
  feedback?: { placeholder?: string; value?: string }
}

export function ApproveRejectBarMock({
  approveLabel,
  rejectLabel,
  approveSuffix,
  extraActions,
  focused = "approve",
  feedback,
}: ApproveRejectBarMockProps) {
  const t = useMockT()
  const enterRejects = focused === "feedback"
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PermissionActionButtonMock tone="approve" kbd={enterRejects ? undefined : "⏎"} focused={focused === "approve"}>
        {approveLabel ?? t("chat.permission.allow")}
        {approveSuffix}
      </PermissionActionButtonMock>
      {extraActions}
      <PermissionActionButtonMock tone="reject" kbd={enterRejects ? "↵" : "esc"} focused={focused === "reject"}>
        {rejectLabel ?? t("chat.permission.deny")}
      </PermissionActionButtonMock>
      {feedback && (
        <PermissionFeedbackInputMock
          placeholder={feedback.placeholder ?? t("chat.permission.denyReasonPlaceholder")}
          value={feedback.value}
          focused={focused === "feedback"}
        />
      )}
    </div>
  )
}
