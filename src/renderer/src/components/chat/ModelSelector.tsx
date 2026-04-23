import { useState, useEffect } from 'react'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChevronDown, Loader2, Zap } from 'lucide-react'
import { formatCodexModelLabel, formatReasoningEffortLabel } from './chat-input-utils'
import { CodexModeSelector } from './CodexModeSelector'
import { FireText } from './FireText'
import {
  ClaudeModelList,
  CodexModelList,
  CodexReasoningEffortList,
  EffortList,
} from './ModelSelectorLists'
import type { EffortLevel } from '../../../../shared/agent-types'

const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
}

export function ModelSelector({ onCloseAutoFocus }: { onCloseAutoFocus?: (e: Event) => void } = {}) {
  const [modelOpen, setModelOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)

  const selectedModel = useActiveSession((s) => s.selectedModel)
  const selectedEffort = useActiveSession((s) => s.selectedEffort)
  const selectedCodexModel = useActiveSession((s) => s.selectedCodexModel)
  const selectedCodexReasoningEffort = useActiveSession((s) => s.selectedCodexReasoningEffort)
  const codexModels = useActiveSession((s) => s.codexModels)
  const codexModelsLoading = useActiveSession((s) => s.codexModelsLoading)
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const availableModels = useChatStore((s) => s.availableModels)
  const setSelectedModel = useChatStore((s) => s.setSelectedModel)
  const setSelectedEffort = useChatStore((s) => s.setSelectedEffort)
  const setSelectedCodexModel = useChatStore((s) => s.setSelectedCodexModel)
  const setSelectedCodexReasoningEffort = useChatStore((s) => s.setSelectedCodexReasoningEffort)
  const refreshCodexModels = useChatStore((s) => s.refreshCodexModels)

  const activeProvider = sessionProvider ?? preferredProvider

  const fastModeState = useActiveSession((s) => s.session?.fastModeState)

  const currentModel = availableModels.find((m) => m.id === selectedModel)
  const currentModelName = (currentModel?.name ?? selectedModel) || null
  const effortLevels = currentModel?.supportedEffortLevels
  const currentEffortLabel = selectedEffort ? EFFORT_LABELS[selectedEffort] : null

  const selectedCodexModelOption = codexModels.find((m) => m.id === selectedCodexModel)
  const currentCodexModelName =
    selectedCodexModelOption
      ? formatCodexModelLabel(selectedCodexModelOption.id || selectedCodexModelOption.name)
      : selectedCodexModel
        ? formatCodexModelLabel(selectedCodexModel)
        : null
  const codexReasoningEfforts = selectedCodexModelOption?.supportedReasoningEfforts ?? []
  const currentCodexReasoningEffort =
    selectedCodexReasoningEffort
    ?? selectedCodexModelOption?.defaultReasoningEffort
    ?? codexReasoningEfforts[0]?.value
    ?? null
  const currentCodexReasoningEffortLabel = currentCodexReasoningEffort
    ? formatReasoningEffortLabel(currentCodexReasoningEffort)
    : null

  useEffect(() => {
    if (activeProvider !== 'codex') return
    if (codexModelsLoading || codexModels.length > 0) return
    void refreshCodexModels()
  }, [activeProvider, codexModelsLoading, codexModels.length, refreshCodexModels])

  if (activeProvider === 'claude') {
    return (
      <div className="flex items-center gap-1">
        {fastModeState && fastModeState !== 'off' && (
          <span title={`Fast mode: ${fastModeState}`}>
            <Zap className={`size-3 ${fastModeState === 'on' ? 'text-yellow-500' : 'text-muted-foreground'}`} />
          </span>
        )}
        <Popover open={modelOpen} onOpenChange={setModelOpen}>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
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
              title="Select Model"
              models={availableModels}
              activeId={selectedModel ?? ''}
              onSelect={(id) => { setSelectedModel(id); setModelOpen(false) }}
            />
          </PopoverContent>
        </Popover>

        {effortLevels && effortLevels.length > 0 && (
          <Popover open={effortOpen} onOpenChange={setEffortOpen}>
            <PopoverTrigger asChild>
              <button className={`flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs transition-colors hover:bg-muted hover:text-foreground ${selectedEffort === 'high' || selectedEffort === 'max' ? '' : 'text-muted-foreground'}`}>
                {selectedEffort === 'max' ? <FireText>MAX</FireText> : <span className={`max-w-[100px] truncate ${selectedEffort === 'high' ? 'rainbow-text font-normal' : ''}`}>{selectedEffort === 'high' ? 'ULTRATHINK' : (currentEffortLabel ?? 'Effort')}</span>}
                <ChevronDown className={`size-3 transition-transform duration-200 ${effortOpen ? 'rotate-180' : ''}`} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="top" className="w-48 border-border bg-card p-1" onCloseAutoFocus={onCloseAutoFocus}>
              <EffortList
                title="Thinking Effort"
                levels={effortLevels}
                labels={EFFORT_LABELS}
                activeLevel={selectedEffort ?? ''}
                onSelect={(level) => { setSelectedEffort(level); setEffortOpen(false) }}
              />
            </PopoverContent>
          </Popover>
        )}

      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Popover
        open={modelOpen}
        onOpenChange={(open) => { setModelOpen(open); if (open) void refreshCodexModels() }}
      >
        <PopoverTrigger asChild>
          <button className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            {currentCodexModelName ? (
              <span className="max-w-[140px] truncate">{currentCodexModelName}</span>
            ) : codexModelsLoading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <span>Codex model</span>
            )}
            <ChevronDown className={`size-3 transition-transform duration-200 ${modelOpen ? 'rotate-180' : ''}`} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-72 max-h-60 overflow-y-auto border-border bg-card p-1" onCloseAutoFocus={onCloseAutoFocus}>
          <CodexModelList
            title="Select Model"
            models={codexModels}
            activeId={selectedCodexModel ?? ''}
            onSelect={(id) => { setSelectedCodexModel(id); setModelOpen(false) }}
            loading={codexModelsLoading}
          />
        </PopoverContent>
      </Popover>

      {codexReasoningEfforts.length > 0 && (
        <Popover open={effortOpen} onOpenChange={setEffortOpen}>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <span className="max-w-[120px] truncate">
                {currentCodexReasoningEffortLabel ?? formatReasoningEffortLabel(codexReasoningEfforts[0].value)}
              </span>
              <ChevronDown className={`size-3 transition-transform duration-200 ${effortOpen ? 'rotate-180' : ''}`} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" className="w-72 max-h-60 overflow-y-auto border-border bg-card p-1" onCloseAutoFocus={onCloseAutoFocus}>
            <CodexReasoningEffortList
              title="Reasoning Effort"
              options={codexReasoningEfforts}
              activeValue={currentCodexReasoningEffort ?? ''}
              onSelect={(value) => { setSelectedCodexReasoningEffort(value); setEffortOpen(false) }}
            />
          </PopoverContent>
        </Popover>
      )}

      {activeProvider === 'codex' && <CodexModeSelector />}
    </div>
  )
}
