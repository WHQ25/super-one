import { useRef, useState } from 'react'
import { Bot, ChevronDown, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { OpenCodeAgentOption } from '@superone/shared/agent-types'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { selectOpenCodeAgents, useActiveSession, useChatStore, useScopedSessionActions } from '@/stores/chat'
import { modes } from './PermissionModeList'
import { PERMISSION_POPOVER_CLASS } from './permissionPopoverStyles'
import { useOpenCodeResourceRefresh } from './useOpenCodeResourceRefresh'

function agentStyle(id: string | null) {
  return modes.find((mode) => mode.id === (id === 'plan' ? 'plan' : 'default'))!
}

/** Native primary agents, independently of the model and its effort variant. */
export function OpenCodeAgentPicker({ agents, value, onChange, compact = false, onRefresh, loading = false, error }: {
  agents: OpenCodeAgentOption[]
  value: string | null
  onChange: (agentId: string) => void
  compact?: boolean
  onRefresh: () => void
  loading?: boolean
  error?: string | null
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const current = agents.find((agent) => agent.id === value)
  const label = current?.name ?? value ?? t('chat.opencode.defaultAgent')
  const style = agentStyle(value)
  const icon = value === 'plan' ? style.icon : <Bot className="size-3 shrink-0" />
  const title = `${t('chat.opencode.agent')}: ${label}`
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {compact ? (
          <IconButton size="xs" tooltip={title} className={`${style.color} ${style.hoverBg}`}>{icon}</IconButton>
        ) : (
          <button type="button" aria-label={title} title={current?.description ?? title}
            className={`flex min-w-0 items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors ${style.color} ${style.hoverBg}`}>
            {icon}
            <span className="max-w-30 truncate">{label}</span>
            <ChevronDown className={`size-3 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent ref={contentRef} align="start" side="top"
        className={`${PERMISSION_POPOVER_CLASS} max-h-80 overflow-y-auto`}
        onOpenAutoFocus={(event) => {
          // Focus the selection, rather than opening the first toolbar button's tooltip.
          event.preventDefault()
          const content = contentRef.current
          const selection = content?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
            ?? content?.querySelector<HTMLButtonElement>('button[aria-pressed]')
          const target = selection ?? content
          target?.focus()
        }}>
        <div className="flex items-center justify-between pr-1">
          <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('chat.opencode.agent')}</div>
          <IconButton size="xs" variant="nested" tooltip={t('chat.opencode.refreshAgents')} disabled={loading}
            onClick={(event) => { event.preventDefault(); event.stopPropagation(); onRefresh() }}>
            <RefreshCw className={loading ? 'animate-spin' : undefined} />
          </IconButton>
        </div>
        {error && <p role="alert" className="px-2 py-1.5 text-xs text-destructive">{error}</p>}
        {agents.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">{t(loading ? 'chat.opencode.loadingAgents' : 'chat.opencode.noAgents')}</p>
        ) : (
          agents.map((agent) => {
            const option = agentStyle(agent.id)
            const active = agent.id === value
            return (
              <button key={agent.id} type="button" aria-pressed={active}
                onClick={() => { onChange(agent.id); setOpen(false) }}
                className={`w-full rounded px-2 py-1.5 text-left text-xs text-foreground transition-colors ${active ? option.activeBg : option.hoverBg}`}>
                <div className={`flex items-center gap-1.5 font-medium ${option.color}`}>
                  {agent.id === 'plan' ? option.icon : <Bot className="size-3 shrink-0" />}
                  <span className="min-w-0 break-words">{agent.name}</span>
                </div>
                {agent.description && <p className="mt-0.5 break-words text-xs text-muted-foreground">{agent.description}</p>}
              </button>
            )
          })
        )}
      </PopoverContent>
    </Popover>
  )
}

export function OpenCodeAgentSelector({ compact = false }: { compact?: boolean }) {
  const catalog = useChatStore(selectOpenCodeAgents)
  const sessionAgents = useActiveSession((state) => state.sessionAgents)
  const agents = sessionAgents ?? catalog
  const agentId = useActiveSession((state) => state.openCodeAgentId)
  const { setOpenCodeAgentId } = useScopedSessionActions()
  const { refresh, loading, error } = useOpenCodeResourceRefresh('agents')
  return <OpenCodeAgentPicker agents={agents} value={agentId} onChange={setOpenCodeAgentId} compact={compact}
    onRefresh={() => void refresh()} loading={loading} error={error} />
}
