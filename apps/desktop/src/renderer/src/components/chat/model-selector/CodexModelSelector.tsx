import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Loader2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { formatCodexModelLabel, formatReasoningEffortLabel } from '../chat-input-utils'
import { CodexModeSelector } from '../CodexModeSelector'
import { CodexModelList, CodexReasoningEffortList } from '../ModelSelectorLists'

interface Props {
  onCloseAutoFocus?: (e: Event) => void
}

export function CodexModelSelector({ onCloseAutoFocus }: Props) {
  const { t } = useTranslation()
  const [modelOpen, setModelOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)

  const selectedCodexModel = useActiveSession((s) => s.selectedCodexModel)
  const selectedCodexReasoningEffort = useActiveSession((s) => s.selectedCodexReasoningEffort)
  const codexModels = useActiveSession((s) => s.codexModels)
  const codexModelsLoading = useActiveSession((s) => s.codexModelsLoading)
  const setSelectedCodexModel = useChatStore((s) => s.setSelectedCodexModel)
  const setSelectedCodexReasoningEffort = useChatStore((s) => s.setSelectedCodexReasoningEffort)
  const refreshCodexModels = useChatStore((s) => s.refreshCodexModels)

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
    if (codexModelsLoading || codexModels.length > 0) return
    void refreshCodexModels()
  }, [codexModelsLoading, codexModels.length, refreshCodexModels])

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
              <span>{t('chat.codex.modelFallback')}</span>
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
              title={t('tooltips.reasoningEffort')}
              options={codexReasoningEfforts}
              activeValue={currentCodexReasoningEffort ?? ''}
              onSelect={(value) => { setSelectedCodexReasoningEffort(value); setEffortOpen(false) }}
            />
          </PopoverContent>
        </Popover>
      )}

      <CodexModeSelector />
    </div>
  )
}
