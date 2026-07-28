import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { DEFAULT_CODEX_PERMISSION_PRESET, type CodexPermissionPreset } from '@superone/shared/agent-types'
import { CodexPermissionPresetList, codexPermissionPresetOptions } from './CodexPermissionPresetList'

interface CodexPermissionSelectorProps {
  compact?: boolean
}

export function CodexPermissionSelector({ compact = false }: CodexPermissionSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const selectedPreset = useActiveSession((s) => s.selectedCodexPermissionPreset)
  const setSelectedPreset = useChatStore((s) => s.setSelectedCodexPermissionPreset)
  const preset: CodexPermissionPreset = selectedPreset || DEFAULT_CODEX_PERMISSION_PRESET
  const activeOption = codexPermissionPresetOptions.find((option) => option.id === preset) ?? codexPermissionPresetOptions[1]
  const activeLabel = t(activeOption.labelKey)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors ${activeOption.triggerToneClass}`}
          title={activeLabel}
        >
          {activeOption.triggerIcon}
          {!compact && <span>{activeLabel}</span>}
          {!compact && <ChevronDown className={`size-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-72 border-border bg-popover p-2">
        <CodexPermissionPresetList
          activePreset={preset}
          onSelect={(nextPreset) => {
            setSelectedPreset(nextPreset)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
