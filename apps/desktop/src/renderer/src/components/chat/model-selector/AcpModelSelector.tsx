import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Loader2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { useActiveSession, useChatStore } from '@/stores/chat'
import type { AcpAgentDescriptor } from '@superone/shared/agent-types'
import { ClaudeModelList } from '../ModelSelectorLists'

const EMPTY_ACP_AGENTS: AcpAgentDescriptor[] = []

export function AcpModelSelector({ onCloseAutoFocus }: { onCloseAutoFocus?: (e: Event) => void } = {}) {
  const { t } = useTranslation()
  const [modelOpen, setModelOpen] = useState(false)

  const acpAgentId = useActiveSession((s) => s.acpAgentId)
  const acpModels = useActiveSession((s) => s.acpModels)
  const acpModelsStatus = useActiveSession((s) => s.acpModelsStatus)
  const acpModelsError = useActiveSession((s) => s.acpModelsError)
  const selectedModel = useActiveSession((s) => s.selectedModel)
  const agents = useChatStore((s) => s.harnessResources.acp?.agents ?? EMPTY_ACP_AGENTS)
  const setSelectedModel = useChatStore((s) => s.setSelectedModel)

  const agent = agents.find((a) => a.id === acpAgentId)
  const currentModel = acpModels.find((m) => m.id === selectedModel)
  const currentLabel = currentModel?.name
    ?? selectedModel
    ?? agent?.name
    ?? t('chat.suggestions.acpLabel')

  if (acpModelsStatus === 'loading' || (acpModelsStatus === 'idle' && agent?.installed)) {
    return (
      <div className="flex items-center gap-1">
        <span className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          <span className="max-w-[140px] truncate">{agent?.name ?? t('chat.suggestions.selectAgent')}</span>
        </span>
      </div>
    )
  }

  if (acpModels.length === 0) {
    const hint = acpModelsError
      ?? (!agent?.installed ? t('chat.suggestions.agentNotInstalled') : t('chat.suggestions.acpLabel'))
    return (
      <div className="flex items-center gap-1">
        <span
          className="max-w-[180px] truncate rounded-lg px-2 py-1 text-xs text-muted-foreground"
          title={acpModelsError ?? agent?.commandPreview ?? hint}
        >
          {agent?.name ?? t('chat.suggestions.acpLabel')}
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Popover open={modelOpen} onOpenChange={setModelOpen}>
        <PopoverTrigger asChild>
          <button className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <span className="max-w-[160px] truncate">{currentLabel}</span>
            <ChevronDown className={`size-3 transition-transform duration-200 ${modelOpen ? 'rotate-180' : ''}`} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          className="w-64 max-h-60 overflow-y-auto border-border bg-popover p-1"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <ClaudeModelList
            title={t('tooltips.selectModel')}
            models={acpModels}
            activeId={selectedModel ?? ''}
            onSelect={(id) => { setSelectedModel(id); setModelOpen(false) }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
