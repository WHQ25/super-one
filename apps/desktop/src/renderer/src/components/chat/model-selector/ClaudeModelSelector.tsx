import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Loader2, Zap } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import type { AgentProviderConfig, EffortLevel } from '@superone/shared/agent-types'
import { parseProviderModelEnv } from '@superone/shared/agent-types'
import { useActiveSession, useChatStore, selectClaudeModels } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { selectEffectiveApiProvider } from '@/lib/effective-api-provider'
import { FireText } from '../FireText'
import { ClaudeModelList, EffortList, resolveClaudeDisplayName } from '../ModelSelectorLists'

const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
}

interface Props {
  onCloseAutoFocus?: (e: Event) => void
}

export function ClaudeModelSelector({ onCloseAutoFocus }: Props) {
  const { t } = useTranslation()
  const [modelOpen, setModelOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)

  const selectedModel = useActiveSession((s) => s.selectedModel)
  const selectedEffort = useActiveSession((s) => s.selectedEffort)
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const sessionApiProviderId = useActiveSession((s) => s.apiProviderId)
  const availableModels = useChatStore(selectClaudeModels)
  const setSelectedModel = useChatStore((s) => s.setSelectedModel)
  const setSelectedEffort = useChatStore((s) => s.setSelectedEffort)

  const activeProvider = sessionProvider ?? preferredProvider

  const providers = useSettingsStore((s) => s.providers)
  const fetchProviders = useSettingsStore((s) => s.fetchProviders)
  useEffect(() => { void fetchProviders() }, [fetchProviders])
  const activeApiProvider = useMemo(
    () => selectEffectiveApiProvider(providers, activeProvider, sessionApiProviderId),
    [providers, activeProvider, sessionApiProviderId],
  )
  const activeModelEnv = useMemo(() => {
    if (!activeApiProvider) return null
    try {
      const configs = JSON.parse(activeApiProvider.agent_configs || '{}') as Record<string, AgentProviderConfig>
      const claudeConfig = configs.claude
      if (!claudeConfig) return null
      const parsed = parseProviderModelEnv(claudeConfig.model_env)
      return Object.keys(parsed).length > 0 ? parsed : null
    } catch {
      return null
    }
  }, [activeApiProvider])

  const forcedEffort = useMemo<EffortLevel | 'auto' | null>(() => {
    if (!activeApiProvider) return null
    try {
      const configs = JSON.parse(activeApiProvider.agent_configs || '{}') as Record<string, AgentProviderConfig>
      const claudeConfig = configs.claude
      if (!claudeConfig) return null
      const extraEnv = JSON.parse(claudeConfig.extra_env || '{}') as Record<string, string>
      const raw = (extraEnv.CLAUDE_CODE_EFFORT_LEVEL ?? '').toLowerCase().trim()
      if (!raw) return null
      if (raw === 'auto') return 'auto'
      if (raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'xhigh' || raw === 'max') return raw
      return null
    } catch {
      return null
    }
  }, [activeApiProvider])

  const forcedEffortLabel = forcedEffort === 'auto' ? 'Auto' : forcedEffort ? EFFORT_LABELS[forcedEffort] : null

  const fastModeState = useActiveSession((s) => s.session?.fastModeState)

  const currentModel = availableModels.find((m) => m.id === selectedModel)
  const currentModelName = resolveClaudeDisplayName(currentModel, activeModelEnv) ?? selectedModel ?? null
  const effortLevels = currentModel?.supportedEffortLevels
  const currentEffortLabel = selectedEffort ? EFFORT_LABELS[selectedEffort] : null

  return (
    <div className="flex items-center gap-1">
      {fastModeState && fastModeState !== 'off' && (
        <span title={t('tooltips.fastMode', { state: fastModeState })}>
          <Zap className={`size-3 ${fastModeState === 'on' ? 'text-yellow-500' : 'text-muted-foreground'}`} />
        </span>
      )}
      <Popover open={modelOpen} onOpenChange={setModelOpen}>
        <PopoverTrigger asChild>
          <button className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            {currentModelName ? (
              <span className="max-w-[140px] truncate">{currentModelName}</span>
            ) : (
              <Loader2 className="size-3 animate-spin" />
            )}
            <ChevronDown className={`size-3 transition-transform duration-200 ${modelOpen ? 'rotate-180' : ''}`} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-64 max-h-60 overflow-y-auto border-border bg-card p-1" onCloseAutoFocus={onCloseAutoFocus}>
          <ClaudeModelList
            title={t('tooltips.selectModel')}
            models={availableModels}
            activeId={selectedModel ?? ''}
            onSelect={(id) => { setSelectedModel(id); setModelOpen(false) }}
            modelEnv={activeModelEnv}
          />
        </PopoverContent>
      </Popover>

      {activeModelEnv ? (
        forcedEffortLabel && (
          <span
            title={t('tooltips.effortFromEnv')}
            className="flex cursor-default items-center gap-0.5 rounded-lg px-2 py-1 text-xs text-muted-foreground"
          >
            <span className="max-w-[100px] truncate">{forcedEffortLabel}</span>
          </span>
        )
      ) : (
        effortLevels && effortLevels.length > 0 && (
          <Popover open={effortOpen} onOpenChange={setEffortOpen}>
            <PopoverTrigger asChild>
              <button className={`flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs transition-colors hover:bg-muted hover:text-foreground ${selectedEffort === 'high' || selectedEffort === 'max' ? '' : 'text-muted-foreground'}`}>
                {selectedEffort === 'max' ? <FireText>MAX</FireText> : <span className={`max-w-[100px] truncate ${selectedEffort === 'high' ? 'rainbow-text font-normal' : ''}`}>{selectedEffort === 'high' ? 'ULTRATHINK' : (currentEffortLabel ?? 'Effort')}</span>}
                <ChevronDown className={`size-3 transition-transform duration-200 ${effortOpen ? 'rotate-180' : ''}`} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="top" className="w-48 border-border bg-card p-1" onCloseAutoFocus={onCloseAutoFocus}>
              <EffortList
                title={t('tooltips.thinkingEffort')}
                levels={effortLevels}
                labels={EFFORT_LABELS}
                activeLevel={selectedEffort ?? ''}
                onSelect={(level) => { setSelectedEffort(level); setEffortOpen(false) }}
              />
            </PopoverContent>
          </Popover>
        )
      )}
    </div>
  )
}
