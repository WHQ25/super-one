import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, ChevronDown, ChevronUp, Copy } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import type { AgentErrorInfo } from '@superone/shared/agent-types'
import { tryCopy } from '@/lib/clipboard'
import {
  buildAgentErrorClipboardText,
  buildAgentErrorDetails,
  resolveAgentErrorKind,
} from './agent-error-presentation'

/**
 * Footer badge for a failed turn. Three levels of disclosure: the badge says
 * what went wrong in plain language, the popover says what to do about it, and
 * "error details" holds the identifiers worth pasting into a bug report.
 */
export function MessageErrorBadge({ info }: { info: AgentErrorInfo }) {
  const { t } = useTranslation()
  const kind = resolveAgentErrorKind(info)
  const rows = useMemo(() => buildAgentErrorDetails(info), [info])
  // An unmapped failure has no useful plain-language hint, so lead with the raw
  // text instead of hiding it behind another click.
  const [detailsOpen, setDetailsOpen] = useState(kind === 'unknown')
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!(await tryCopy(buildAgentErrorClipboardText(info)))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1 text-warning transition-opacity hover:opacity-80"
        >
          <AlertTriangle className="size-3" />
          <span>{t(`chat.error.title.${kind}`)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-90 p-3">
        <p className="text-sm font-medium">{t(`chat.error.title.${kind}`)}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {t(`chat.error.hint.${kind}`)}
        </p>
        <div className="mt-3 flex items-center gap-2 border-t pt-2">
          <button
            type="button"
            onClick={() => setDetailsOpen((open) => !open)}
            className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <span>{t('chat.error.detailsToggle')}</span>
            {detailsOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
          <div className="flex-1" />
          <IconButton
            size="xs"
            onClick={handleCopy}
            tooltip={copied ? t('chat.error.copied') : t('chat.error.copy')}
          >
            {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
          </IconButton>
        </div>
        {detailsOpen && (
          <div className="mt-2 rounded-md bg-muted/60 p-2.5 font-mono text-xs leading-relaxed text-muted-foreground">
            {rows.map((row) => (
              <div key={row.label} className="flex gap-2">
                <span className="w-28 shrink-0 opacity-60">{row.label}</span>
                <span className="min-w-0 break-all">{row.value}</span>
              </div>
            ))}
            <p className={`break-all whitespace-pre-wrap ${rows.length > 0 ? 'mt-2 border-t pt-2' : ''}`}>
              {info.raw}
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
