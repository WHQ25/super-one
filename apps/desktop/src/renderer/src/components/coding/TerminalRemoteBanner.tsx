import { Laptop, Smartphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@superone/ui/components/ui/badge'
import type { TerminalHolder } from './terminal-holder'

/**
 * Under a terminal another client writes in: it names the client and offers
 * what this window may do. This computer's window takes its own tabs back
 * (Disconnect); a controller takes over a remote tab its node's window holds,
 * and only reads one a phone or another computer holds.
 */
export function TerminalRemoteBanner({ holder, hostName, action, onAction }: {
  holder: Exclude<TerminalHolder, 'me'>
  /** The computer a remote tab runs on, for `host`; null until known. */
  hostName?: string | null
  /** Without one the tab is view-only here. */
  action?: 'disconnect' | 'takeOver'
  onAction?: () => void
}) {
  const { t } = useTranslation()
  const Icon = holder === 'phone' ? Smartphone : Laptop
  const message = holder === 'host'
    ? hostName ? t('shell.terminal.heldBy.host', { host: hostName }) : t('shell.terminal.heldBy.hostUnnamed')
    : t(`shell.terminal.heldBy.${holder}`)
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 border-t border-border px-4 py-2 text-center text-sm text-muted-foreground" role="status">
      <span className="flex min-w-0 max-w-full items-center gap-x-2">
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 break-words">{message}</span>
      </span>
      {action ? (
        <button
          type="button"
          onClick={onAction}
          className="text-foreground underline underline-offset-2 hover:opacity-80"
        >
          {t(`shell.terminal.${action}`)}
        </button>
      ) : (
        <Badge variant="outline" className="text-muted-foreground">{t('shell.terminal.viewOnly')}</Badge>
      )}
    </div>
  )
}
