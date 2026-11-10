import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RealtimeDelegation } from '@superone/shared/realtime-timeline'
import { cn } from '@superone/ui/lib/utils'

/**
 * Body of a voice-delegation bubble. A separate instruction is the paragraph.
 * The spoken script folds underneath it. Plain text, never the paste chip.
 *
 * A tail flush, or a handoff whose only content is the script, opens that
 * script and leaves the instruction out.
 */
export function RealtimeDelegationBody({ delegation }: { delegation: RealtimeDelegation }) {
  const { t } = useTranslation()
  const tailFlush = delegation.source === 'transcript_tail_flush'
  const showInput = !tailFlush && delegation.input.length > 0
  const [open, setOpen] = useState(tailFlush || !showInput)
  const { transcript } = delegation

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {showInput && (
        <p className="whitespace-pre-wrap break-words">{delegation.input}</p>
      )}
      {transcript.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="flex items-center gap-1 self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            {t('chat.realtimeVoice.delegation.transcript', { count: transcript.length })}
          </button>
          {open && (
            <ul className="flex flex-col gap-0.5 border-l border-border/60 pl-2 text-xs">
              {transcript.map((line, index) => (
                <li key={index} className="flex min-w-0 gap-1.5">
                  {line.role && (
                    <span className={cn('shrink-0 text-muted-foreground', line.role === 'user' && 'text-foreground/70')}>
                      {line.role}
                    </span>
                  )}
                  <span className="min-w-0 whitespace-pre-wrap break-words text-muted-foreground">{line.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
