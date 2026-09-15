import { Bot } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Status line under a tab while an agent drives the command it was approved
 * for. Purely informative: the user can type into the tab at any time, and the
 * agent's control ends on its own when the command exits.
 */
export function TerminalAgentBanner(props: { command: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-center gap-x-2 border-t border-border px-4 py-2 text-sm text-muted-foreground">
      <Bot className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">
        {t('activity.terminal.agentBanner', { command: props.command })}
      </span>
    </div>
  )
}
