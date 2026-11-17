import { useTranslation } from 'react-i18next'
import { CircleAlert, RotateCw } from 'lucide-react'
import { parseInputRequestError } from '@superone/shared/input-request'
import { isTransportSendError } from '@superone/shared/send-failure'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'

export interface SendFailureResendButtonProps {
  error: string
  onResend: () => void
  showTransportError?: boolean
}

/**
 * Marks a user bubble the host never took. Its tooltip explains refusals
 * and, for remote desktop conversations, connection failures.
 */
export function SendFailureResendButton({ error, onResend, showTransportError }: SendFailureResendButtonProps) {
  const { t } = useTranslation()
  const label = t('chat.sendFailure.resend')
  const formError = parseInputRequestError(error)
  const retryable = !formError
  const reason = !showTransportError && isTransportSendError(error) ? null : formError?.message ?? error
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-send-failure
            aria-label={retryable ? label : reason ?? label}
            onClick={retryable ? onResend : undefined}
            aria-disabled={!retryable}
            // Tailwind v4 `hover:` only matches hover-capable pointers, so a tap on
            // the phone never leaves the button stuck filled.
            className="shrink-0 rounded-full p-1 text-error transition-colors hover:bg-error hover:text-error-foreground"
          >
            {retryable ? <RotateCw className="size-4" aria-hidden /> : <CircleAlert className="size-4" aria-hidden />}
          </button>
        </TooltipTrigger>
        {/* Above and growing leftward, so it never covers the bubble — a left-side
            tooltip flips onto the text when a long message leaves no room. */}
        <TooltipContent side="top" align="end" className="max-w-72">
          {retryable && <p>{label}</p>}
          {reason && <p className="mt-0.5 break-words opacity-70">{reason}</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
