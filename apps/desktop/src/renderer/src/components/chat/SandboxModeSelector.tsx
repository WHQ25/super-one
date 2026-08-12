import { Box, PackageOpen, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useState } from 'react'
import type { HarnessId, SandboxMode } from '@superone/shared/agent-types'
import {
  coerceSandboxModeForHarness,
  harnessSandboxModes,
  harnessSandboxSupportLevel,
} from './sandboxHarness'

export {
  coerceSandboxModeForHarness,
  harnessSandboxModes,
  harnessSandboxSupportLevel,
  harnessSupportsSandbox,
} from './sandboxHarness'

export const sandboxModes: { id: SandboxMode; label: string; triggerLabel: string; description: string; icon: React.ReactNode; color: string; hoverBg: string; activeBg: string }[] = [
  {
    id: 'off',
    label: 'Sandbox Off',
    triggerLabel: 'Off',
    description: 'No execution isolation',
    icon: <PackageOpen className="size-3" />,
    color: 'text-muted-foreground',
    hoverBg: 'hover:bg-accent',
    activeBg: 'bg-accent',
  },
  {
    id: 'on',
    label: 'Sandbox',
    triggerLabel: 'On',
    description: 'Commands run in sandboxed environment',
    icon: <Box className="size-3" />,
    color: 'text-emerald-500 dark:text-emerald-400',
    hoverBg: 'hover:bg-emerald-500/10',
    activeBg: 'bg-emerald-500/15',
  },
  {
    id: 'auto',
    label: 'Sandbox Auto',
    triggerLabel: 'Auto',
    description: 'Sandbox with auto-allow Bash',
    icon: <Box className="size-3" />,
    color: 'text-amber-500 dark:text-amber-400',
    hoverBg: 'hover:bg-amber-500/10',
    activeBg: 'bg-amber-500/15',
  },
]

function getSandboxMode(info: { enabled: boolean; autoAllowBash: boolean }): SandboxMode {
  if (!info.enabled) return 'off'
  return info.autoAllowBash ? 'auto' : 'on'
}

interface SandboxModePopoverProps {
  compact?: boolean
  value: SandboxMode
  onValueChange: (mode: SandboxMode) => void
  supportLevel?: 'always' | 'conditional' | 'unsupported'
  showNotReadyHint?: boolean
  onOpenSettings?: () => void
  /** Restrict offered modes (Cursor: off/on only). */
  availableModes?: SandboxMode[]
}

export function SandboxModePopover({
  compact = false,
  value,
  onValueChange,
  supportLevel = 'always',
  showNotReadyHint = false,
  onOpenSettings,
  availableModes,
}: SandboxModePopoverProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const visibleModes = availableModes
    ? sandboxModes.filter((mode) => availableModes.includes(mode.id))
    : sandboxModes
  const current = visibleModes.find((m) => m.id === value) ?? visibleModes[0] ?? sandboxModes[1]
  const currentLabel = t(`chat.sandboxModes.${current.id}.label`)

  const triggerTitle =
    supportLevel === 'unsupported'
      ? t('chat.sandboxUnsupportedTooltip')
      : currentLabel

  const optionDisabled = (id: SandboxMode): boolean => {
    if (id === 'off') return false
    if (supportLevel === 'unsupported') return true
    return false
  }

  const handleSelect = (id: SandboxMode): void => {
    if (optionDisabled(id)) return
    setOpen(false)
    onValueChange(id)
  }

  const handleOpenSettings = (): void => {
    setOpen(false)
    onOpenSettings?.()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors ${current.color} ${current.hoverBg}`}
          title={triggerTitle}
        >
          {current.icon}
          {!compact && <span>{current.triggerLabel}</span>}
          {!compact && <ChevronDown className={`size-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="w-56 border-border bg-popover p-1"
      >
        <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('chat.sandboxModeTitle')}</div>
        {visibleModes.map((mode) => {
          const isDisabled = optionDisabled(mode.id)
          return (
            <button
              key={mode.id}
              disabled={isDisabled}
              aria-disabled={isDisabled}
              title={isDisabled ? t('chat.sandboxUnsupportedTooltip') : undefined}
              onClick={() => handleSelect(mode.id)}
              className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                mode.id === value
                  ? `${mode.activeBg} text-foreground`
                  : `text-foreground ${mode.hoverBg}`
              } ${isDisabled ? 'cursor-not-allowed opacity-50 hover:bg-transparent' : ''}`}
            >
              <div className={`flex items-center gap-1.5 font-medium ${mode.color}`}>
                {mode.icon}
                {t(`chat.sandboxModes.${mode.id}.label`)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{t(`chat.sandboxModes.${mode.id}.description`)}</div>
            </button>
          )
        })}
        {showNotReadyHint && onOpenSettings && (
          <button
            onClick={handleOpenSettings}
            className="mt-1 w-full rounded border-t border-border px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            {t('chat.sandboxConditionalNotReady')}
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

interface SandboxModeSelectorProps {
  compact?: boolean
}

export function SandboxModeSelector({ compact = false }: SandboxModeSelectorProps) {
  const sandboxInfo = useActiveSession((s) => s.sandboxInfo)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const setSandboxMode = useChatStore((s) => s.setSandboxMode)
  const sandboxCapability = useAppStore((s) => s.sandboxCapability)
  const sandboxProbe = useAppStore((s) => s.sandboxProbe)
  const navigateTo = useAppStore((s) => s.navigateTo)
  const setSettingsTab = useAppStore((s) => s.setSettingsTab)
  const activeProvider = (sessionProvider ?? preferredProvider) as HarnessId
  const availableModes = harnessSandboxModes(activeProvider)
  const supportLevel = harnessSandboxSupportLevel(
    activeProvider,
    sandboxCapability?.supportLevel ?? 'always',
  )
  const effectiveMode = coerceSandboxModeForHarness(activeProvider, getSandboxMode(sandboxInfo))

  return (
    <SandboxModePopover
      compact={compact}
      value={effectiveMode}
      availableModes={availableModes}
      onValueChange={(mode) => { void setSandboxMode(mode) }}
      supportLevel={supportLevel}
      showNotReadyHint={supportLevel === 'conditional' && sandboxProbe !== null && !sandboxProbe.ok}
      onOpenSettings={() => {
        setSettingsTab('preferences')
        navigateTo('settings')
      }}
    />
  )
}
