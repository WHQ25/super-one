import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { formatMessageTime } from './message-time'

function useFormatMessageTime() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  return {
    format: (at: number, sayToday: boolean) => formatMessageTime(at, Date.now(), locale, {
      ...(sayToday ? { today: (time: string) => t('chat.messageTime.today', { time }) } : {}),
      yesterday: (time) => t('chat.messageTime.yesterday', { time }),
    }),
    full: (at: number) => new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' }).format(at),
  }
}

/** Persistent row in front of the first message of a session or of a new day. */
export function MessageDateSeparator({ at }: { at: number }) {
  const { format } = useFormatMessageTime()
  return (
    <div role="separator" className="flex justify-center py-2 text-xs text-muted-foreground">
      <time dateTime={new Date(at).toISOString()}>{format(at, true)}</time>
    </div>
  )
}

/** A message's time for a footer; the tooltip carries the full date. */
export function MessageTimestamp({ iso, className }: { iso: string | undefined; className?: string }) {
  const { format, full } = useFormatMessageTime()
  const at = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(at)) return null
  return (
    <time dateTime={iso} title={full(at)} className={cn('whitespace-nowrap text-muted-foreground', className)}>
      {format(at, false)}
    </time>
  )
}
