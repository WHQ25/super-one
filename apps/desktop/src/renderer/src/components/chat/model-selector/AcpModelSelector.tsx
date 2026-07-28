import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { useActiveSession, useChatStore } from '@/stores/chat'
import type { AcpAgentDescriptor } from '@superone/shared/agent-types'
import { acpAgentDisplayName } from '@superone/shared/acp-brand'
import {
  groupModelsBySlashPrefix,
  resolveSlashModelLabel,
} from '../ModelSelectorLists'
import {
  GroupedModelEffortSelector,
  type SelectorEffortOption,
  type SelectorModelGroup,
  type SelectorModelOption,
} from './GroupedModelEffortSelector'

const EMPTY_ACP_AGENTS: AcpAgentDescriptor[] = []
const NO_EFFORT: SelectorEffortOption[] = []

function useGroupedSlashList(agentId: string | null): boolean {
  // OpenCode catalogs use `provider/model` ids; group by provider.
  if (agentId === 'opencode') return true
  return false
}

/** Compact trigger label: "High Effort" → "High" (matches Claude/Codex style). */
function compactEffortLabel(name: string): string {
  return name.replace(/\s+Effort$/i, '').trim() || name
}

export function AcpModelSelector({ onCloseAutoFocus }: { onCloseAutoFocus?: (e: Event) => void } = {}) {
  const { t } = useTranslation()

  const acpAgentId = useActiveSession((s) => s.acpAgentId)
  const acpModels = useActiveSession((s) => s.acpModels)
  const acpModelsStatus = useActiveSession((s) => s.acpModelsStatus)
  const acpModelsError = useActiveSession((s) => s.acpModelsError)
  const selectedModel = useActiveSession((s) => s.selectedModel)
  // Grok: category=mode options with configId null are reasoning effort (not session mode).
  // Real session modes keep acpModeConfigId set and stay in AcpModeSelector (status bar).
  const acpModes = useActiveSession((s) => s.acpModes)
  const acpModeConfigId = useActiveSession((s) => s.acpModeConfigId)
  const selectedAcpModeId = useActiveSession((s) => s.selectedAcpModeId)
  const agents = useChatStore((s) => s.harnessResources.acp?.agents ?? EMPTY_ACP_AGENTS)
  const setSelectedModel = useChatStore((s) => s.setSelectedModel)
  const setSelectedAcpMode = useChatStore((s) => s.setSelectedAcpMode)

  const agent = agents.find((a) => a.id === acpAgentId)
  // Prefer catalog name; if agents aren't loaded yet (mini-window cold start), derive from id.
  const agentLabel = agent?.name ?? (acpAgentId ? acpAgentDisplayName(acpAgentId) : null)
  const grouped = useGroupedSlashList(acpAgentId)
  const currentModel = acpModels.find((m) => m.id === selectedModel)
  // Prefer catalog display name; fall back to raw selectedModel id (live sync may
  // have the id before acp_models replay fills names).
  const modelLabel = currentModel
    ? (grouped ? resolveSlashModelLabel(currentModel) : (currentModel.name || currentModel.id))
    : (selectedModel || null)
  const currentLabel = modelLabel ?? agentLabel ?? t('chat.suggestions.acpLabel')

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

  // Grok effort lives next to the model (GroupedModelEffortSelector), same as Claude/Codex.
  // Agent may emit high→low; slider is left→right ascending (low … high).
  const effortIsAcpModeCatalog = acpModeConfigId == null && acpModes.length > 0
  const effortOptions = useMemo<SelectorEffortOption[]>(() => {
    if (!effortIsAcpModeCatalog) return NO_EFFORT
    const rank: Record<string, number> = {
      minimal: 0, low: 1, medium: 2, high: 3, xhigh: 4, max: 5,
    }
    const ranked = acpModes.map((m, index) => {
      const key = m.id.trim().toLowerCase()
      const fromName = (m.name || '').trim().toLowerCase().replace(/\s+effort$/, '')
      return { m, index, r: rank[key] ?? rank[fromName] }
    })
    ranked.sort((a, b) => {
      if (a.r != null && b.r != null) return a.r - b.r
      if (a.r != null) return -1
      if (b.r != null) return 1
      return a.index - b.index
    })
    return ranked.map(({ m }) => ({
      value: m.id,
      label: compactEffortLabel(m.name || m.id),
      description: m.description || undefined,
    }))
  }, [effortIsAcpModeCatalog, acpModes])
  const selectedEffort = effortIsAcpModeCatalog
    ? (selectedAcpModeId ?? acpModes[0]?.id ?? null)
    : null
  const selectedEffortLabel = effortIsAcpModeCatalog
    ? compactEffortLabel(
      acpModes.find((m) => m.id === selectedEffort)?.name
        ?? selectedEffort
        ?? '',
    ) || null
    : null

  if (acpModelsStatus === 'loading' || (acpModelsStatus === 'idle' && agent?.installed && !selectedModel)) {
    return (
      <div className="flex items-center gap-1">
        <span className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          <span className="max-w-35 truncate">{modelLabel ?? agentLabel ?? t('chat.suggestions.selectAgent')}</span>
        </span>
      </div>
    )
  }

  if (acpModels.length === 0) {
    // Show known model id even when catalog hasn't arrived (mini-window cold paint).
    if (selectedModel) {
      return (
        <div className="flex items-center gap-1">
          <span
            className="max-w-45 truncate rounded-lg px-2 py-1 text-xs text-muted-foreground"
            title={acpModelsError ?? selectedModel}
          >
            {selectedModel}
          </span>
        </div>
      )
    }
    const hint = acpModelsError
      ?? (!agent?.installed ? t('chat.suggestions.agentNotInstalled') : t('chat.suggestions.acpLabel'))
    return (
      <div className="flex items-center gap-1">
        <span
          className="max-w-45 truncate rounded-lg px-2 py-1 text-xs text-muted-foreground"
          title={acpModelsError ?? agent?.commandPreview ?? hint}
        >
          {agentLabel ?? t('chat.suggestions.acpLabel')}
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
        effortOptions={effortOptions}
        selectedEffort={selectedEffort}
        selectedEffortLabel={selectedEffortLabel}
        onSelectEffort={setSelectedAcpMode}
        onCloseAutoFocus={onCloseAutoFocus}
      />
    </div>
  )
}
