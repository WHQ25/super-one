import { forwardRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { cn } from '@superone/ui/lib/utils'

/**
 * The approve / reject / feedback vocabulary shared by every prompt that asks the user to
 * let something happen — tool permissions, elicitations, agent collaboration requests.
 * Tones are semantic, not decorative: `approve` is the success pair, `reject` the
 * destructive pair, `primary` the brand-coloured "and remember it" escalation.
 */
export type PermissionActionTone = 'approve' | 'reject' | 'primary' | 'neutral'

const TONE_CLASS: Record<PermissionActionTone, string> = {
  approve: 'bg-success text-success-foreground hover:bg-success/90 focus:ring-success',
  reject: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 focus:ring-destructive',
  primary: 'bg-primary text-primary-foreground text-xs hover:bg-primary/90 focus:ring-ring',
  neutral: 'border border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground focus:ring-ring',
}

const TONE_KBD_CLASS: Record<PermissionActionTone, string> = {
  approve: 'text-success-foreground/70',
  reject: 'text-destructive-foreground/70',
  primary: 'text-primary-foreground/80',
  neutral: 'text-muted-foreground',
}

export const PermissionActionButton = forwardRef<
  HTMLButtonElement,
  {
    tone: PermissionActionTone
    onClick: () => void
    children: ReactNode
    /** Shortcut hint rendered inside the button; omit to hide it. */
    kbd?: ReactNode
    disabled?: boolean
    className?: string
  }
>(function PermissionActionButton({ tone, onClick, children, kbd, disabled, className }, ref) {
  return (
    <Button
      ref={ref}
      size="sm"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'h-7 cursor-pointer px-3 text-xs focus:ring-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
      {kbd !== undefined && <Kbd variant="inline" className={cn('ml-1', TONE_KBD_CLASS[tone])}>{kbd}</Kbd>}
    </Button>
  )
})

/**
 * Free-text note that rides along with the decision. Enter submits a rejection (the reason
 * only matters when you are saying no), which is why the trailing hint flips to ↵ on focus.
 */
export const PermissionFeedbackInput = forwardRef<
  HTMLInputElement,
  {
    value: string
    onChange: (value: string) => void
    focused: boolean
    onFocusChange: (focused: boolean) => void
    placeholder: string
  }
>(function PermissionFeedbackInput({ value, onChange, focused, onFocusChange, placeholder }, ref) {
  return (
    <div className="relative flex min-w-0 basis-full items-center @lg:basis-0 @lg:flex-1">
      <input
        ref={ref}
        data-feedback
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
        placeholder={placeholder}
        className="h-7 w-full rounded bg-muted px-2 pr-12 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <Kbd className="pointer-events-none absolute right-2">{focused ? '↵' : '⇥'}</Kbd>
    </div>
  )
})

/**
 * The canonical decision row: approve, reject, and an optional reason. Enter approves unless
 * the reason box has focus, in which case it rejects — the reject hint reflects that.
 */
export function ApproveRejectBar({
  onApprove,
  onReject,
  approveLabel,
  rejectLabel,
  approveDisabled,
  approveSuffix,
  feedback,
  feedbackRef,
  approveRef,
  rejectRef,
}: {
  onApprove: () => void
  onReject: () => void
  approveLabel?: string
  rejectLabel?: string
  approveDisabled?: boolean
  /** Extra content inside the approve button, e.g. a selected-suggestion count. */
  approveSuffix?: ReactNode
  feedback?: {
    value: string
    onChange: (value: string) => void
    focused: boolean
    onFocusChange: (focused: boolean) => void
    placeholder?: string
  }
  feedbackRef?: React.Ref<HTMLInputElement>
  approveRef?: React.Ref<HTMLButtonElement>
  rejectRef?: React.Ref<HTMLButtonElement>
}) {
  const { t } = useTranslation()
  const focused = feedback?.focused ?? false

  return (
    <div className="flex flex-wrap items-center gap-2">
      <PermissionActionButton
        ref={approveRef}
        tone="approve"
        disabled={approveDisabled}
        onClick={onApprove}
        kbd={focused ? undefined : '⏎'}
      >
        {approveLabel ?? t('chat.permission.allow')}
        {approveSuffix}
      </PermissionActionButton>
      <PermissionActionButton ref={rejectRef} tone="reject" onClick={onReject} kbd={focused ? '↵' : 'esc'}>
        {rejectLabel ?? t('chat.permission.deny')}
      </PermissionActionButton>
      {feedback && (
        <PermissionFeedbackInput
          ref={feedbackRef}
          value={feedback.value}
          onChange={feedback.onChange}
          focused={focused}
          onFocusChange={feedback.onFocusChange}
          placeholder={feedback.placeholder ?? t('chat.permission.denyReasonPlaceholder')}
        />
      )}
    </div>
  )
}
