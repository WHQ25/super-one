import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { useActiveSession, useChatStore } from '@/stores/chat'
import type { AcpAgentDescriptor } from '@superone/shared/agent-types'
import {
  groupModelsBySlashPrefix,
  resolveSlashModelLabel,
  splitSlashModelId,
} from '../ModelSelectorLists'
import { GroupedModelEffortSelector, type SelectorModelGroup, type SelectorModelOption } from './GroupedModelEffortSelector'

const EMPTY_ACP_AGENTS: AcpAgentDescriptor[] = []
const NO_EFFORT: never[] = []

function useGroupedSlashList(agentId: string | null): boolean {
  // OpenCode catalogs use `provider/model` ids; group by provider.
  if (agentId === 'opencode') return true
  return false
}

export function AcpModelSelector({ onCloseAutoFocus }: { onCloseAutoFocus?: (e: Event) => void } = {}) {
  const { t } = useTranslation()

  const acpAgentId = useActiveSession((s) => s.acpAgentId)
  const acpModels = useActiveSession((s) => s.acpModels)
  const acpModelsStatus = useActiveSession((s) => s.acpModelsStatus)
  const acpModelsError = useActiveSession((s) => s.acpModelsError)
  const selectedModel = useActiveSession((s) => s.selectedModel)
  const agents = useChatStore((s) => s.harnessResources.acp?.agents ?? EMPTY_ACP_AGENTS)
  const setSelectedModel = useChatStore((s) => s.setSelectedModel)

  const agent = agents.find((a) => a.id === acpAgentId)
  const grouped = useGroupedSlashList(acpAgentId)
  const currentModel = acpModels.find((m) => m.id === selectedModel)
  const currentLabel = currentModel
    ? (grouped ? resolveSlashModelLabel(currentModel) : (currentModel.name || currentModel.id))
    : selectedModel
      ? (grouped ? splitSlashModelId(selectedModel).label : selectedModel)
      : (agent?.name ?? t('chat.suggestions.acpLabel'))

  const models = useMemo<SelectorModelOption[] | undefined>(
    () => grouped ? undefined : acpModels.map((m) => ({ id: m.id, name: m.name || m.id, description: m.description })),
    [grouped, acpModels],
  )
  const modelGroups = useMemo<SelectorModelGroup[] | undefined>(
    () => grouped
      ? groupModelsBySlashPrefix(acpModels).map(({ group, items }) => ({
          id: group || 'other',
          name: group || 'other',
          models: items.map(({ model, label }) => ({ id: model.id, name: label, description: model.description })),
        }))
      : undefined,
    [grouped, acpModels],
  )

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
      <GroupedModelEffortSelector
        models={models}
        modelGroups={modelGroups}
        selectedModelId={selectedModel}
        selectedModelLabel={currentLabel}
        onSelectModel={setSelectedModel}
        effortOptions={NO_EFFORT}
        selectedEffort={null}
        onSelectEffort={() => undefined}
        onCloseAutoFocus={onCloseAutoFocus}
      />
    </div>
  )
}
