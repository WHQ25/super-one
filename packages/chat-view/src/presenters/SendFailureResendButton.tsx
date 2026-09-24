import { useTranslation } from 'react-i18next'
import { RotateCw } from 'lucide-react'
import { isTransportSendError } from '@superone/shared/send-failure'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'

export interface SendFailureResendButtonProps {
  error: string
  onResend: () => void
}

/**
 * Marks a user bubble the host never took; clicking resends it. A dropped
 * connection needs no explanation, so only a refusal's reason is surfaced —
 * and only on hover, where it cannot crowd the transcript.
 */
export function SendFailureResendButton({ error, onResend }: SendFailureResendButtonProps) {
  const { t } = useTranslation()
  const label = t('chat.sendFailure.resend')
  const reason = isTransportSendError(error) ? null : error
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-send-failure
            aria-label={label}
            onClick={onResend}
            // Tailwind v4 `hover:` only matches hover-capable pointers, so a tap on
            // the phone never leaves the button stuck filled.
            className="shrink-0 rounded-full p-1 text-error transition-colors hover:bg-error hover:text-error-foreground"
          >
            <RotateCw className="size-4" aria-hidden />
          </button>
        </TooltipTrigger>
        {/* Above and growing leftward, so it never covers the bubble — a left-side
            tooltip flips onto the text when a long message leaves no room. */}
        <TooltipContent side="top" align="end" className="max-w-72">
          <p>{label}</p>
          {reason && <p className="mt-0.5 break-words opacity-70">{reason}</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
