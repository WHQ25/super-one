import { Bot, Check, ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { selectOpenCodeAgents, useActiveSession, useChatStore } from '@/stores/chat'
import { resolveDefaultOpenCodeAgent } from '@/stores/chat-store/harness/opencode-handler'

export function OpenCodeAgentSelector({ compact = false }: { compact?: boolean }) {
  const agents = useChatStore(selectOpenCodeAgents)
  const selectedAgentId = useActiveSession((state) => state.openCodeAgentId)
  const permissionMode = useActiveSession((state) => state.permissionMode)
  const setOpenCodeAgentId = useChatStore((state) => state.setOpenCodeAgentId)
  const effectiveAgentId = selectedAgentId ?? resolveDefaultOpenCodeAgent(agents)
  const selected = agents.find((agent) => agent.id === effectiveAgentId)
  const isPlanMode = permissionMode === 'plan'
  const label = isPlanMode ? 'Plan' : selected?.name ?? 'Agent'

  if (agents.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={isPlanMode}>
        <button
          type="button"
          className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-60"
          title={isPlanMode ? 'Plan mode uses the plan agent' : `OpenCode agent: ${label}`}
        >
          <Bot className="size-3" />
          {!compact && <span>{label}</span>}
          {!compact && !isPlanMode && <ChevronDown className="size-3" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>OpenCode agent</DropdownMenuLabel>
        <DropdownMenuGroup>
          {agents.map((agent) => (
            <DropdownMenuItem
              key={agent.id}
              onSelect={() => setOpenCodeAgentId(agent.id)}
              className="items-start gap-2"
            >
              <Bot className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{agent.name}</span>
                {agent.description && (
                  <span className="block whitespace-normal text-[10px] leading-tight text-muted-foreground">
                    {agent.description}
                  </span>
                )}
              </span>
              {agent.id === effectiveAgentId && <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
