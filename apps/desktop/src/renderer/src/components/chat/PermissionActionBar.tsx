import { forwardRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { AutoResizeTextarea } from '@superone/ui/components/ui/auto-resize-textarea'
import { cn } from '@superone/ui/lib/utils'
import { PermissionActionsLayout } from './PermissionActionsLayout'

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
 * Free-text note accompanying a decision. Enter submits; composer modifiers insert a newline.
 */
export const PermissionFeedbackInput = forwardRef<
  HTMLTextAreaElement,
  {
    value: string
    onChange: (value: string) => void
    onFocusChange: (focused: boolean) => void
    placeholder: string
    onSubmit: () => void
    onEscape?: () => void
  }
>(function PermissionFeedbackInput({ value, onChange, onFocusChange, placeholder, onSubmit, onEscape }, ref) {
  return (
    <div className="relative w-full min-w-0">
      <AutoResizeTextarea
        ref={ref}
        data-feedback
        value={value}
        onValueChange={onChange}
        onSubmit={onSubmit}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !onEscape) return
          event.preventDefault()
          event.stopPropagation()
          onEscape()
        }}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-h-7 w-full rounded border-0 bg-muted px-2 py-1.5 text-xs leading-4 text-foreground shadow-none placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  )
})

/**
 * The canonical decision actions, with feedback expanding above the buttons when needed. Enter approves unless
 * the reason box has focus or `enterApproves` is false, in which case it rejects — the
 * reject hint reflects that.
 */
export function ApproveRejectBar({
  onApprove,
  onReject,
  approveLabel,
  rejectLabel,
  approveDisabled,
  enterApproves = true,
  requireExplicitApproval = false,
  approveSuffix,
  extraActions,
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
  /**
   * Whether a bare Enter approves. False when the harness flagged the ask as
   * `defaultToNo`: the approve button then carries no key hint and Enter rejects.
   */
  enterApproves?: boolean
  /** The parent requires a click or Command+Enter rather than bare Enter. */
  requireExplicitApproval?: boolean
  /** Extra content inside the approve button, e.g. a selected-suggestion count. */
  approveSuffix?: ReactNode
  /**
   * Buttons between approve and reject — the "and remember it" escalation, when a
   * prompt has one. Slotted rather than flagged because what "remember" means differs
   * per prompt (this session, this project, this site) and only the caller knows.
   */
  extraActions?: ReactNode
  feedback?: {
    value: string
    onChange: (value: string) => void
    focused: boolean
    onFocusChange: (focused: boolean) => void
    placeholder?: string
  }
  feedbackRef?: React.Ref<HTMLTextAreaElement>
  approveRef?: React.Ref<HTMLButtonElement>
  rejectRef?: React.Ref<HTMLButtonElement>
}) {
  const { t } = useTranslation()
  const focused = feedback?.focused ?? false
  const enterRejects = focused || !enterApproves

  const feedbackInput = feedback && (
    <PermissionFeedbackInput
      ref={feedbackRef}
      value={feedback.value}
      onChange={feedback.onChange}
      onFocusChange={feedback.onFocusChange}
      placeholder={feedback.placeholder ?? t('chat.permission.denyReasonPlaceholder')}
      onSubmit={onReject}
    />
  )
  const actions = (
    <>
      <PermissionActionButton
        ref={approveRef}
        tone="approve"
        disabled={approveDisabled}
        onClick={onApprove}
        kbd={requireExplicitApproval ? '⌘↵' : enterRejects ? undefined : '⏎'}
      >
        {approveLabel ?? t('chat.permission.allow')}
        {approveSuffix}
      </PermissionActionButton>
      {extraActions}
      <PermissionActionButton ref={rejectRef} tone="reject" onClick={onReject} kbd={!requireExplicitApproval && enterRejects ? '↵' : 'esc'}>
        {rejectLabel ?? t('chat.permission.deny')}
      </PermissionActionButton>
    </>
  )
  return feedback ? (
    <PermissionActionsLayout feedback={feedbackInput} feedbackValue={feedback.value}>
      {actions}
    </PermissionActionsLayout>
  ) : (
    <div className="flex flex-wrap items-center gap-2">{actions}</div>
  )
}
