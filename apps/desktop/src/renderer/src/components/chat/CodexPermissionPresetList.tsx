import { AlertTriangle, Check, Eye, ShieldCheck, ShieldOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import type { CodexPermissionPreset } from '@superone/shared/agent-types'

export interface CodexPermissionPresetOption {
  id: CodexPermissionPreset
  labelKey: 'resources.automation.readOnly' | 'resources.automation.defaultValue' | 'resources.automation.fullAccess'
  descriptionKey: 'resources.automation.readOnlyDesc' | 'resources.automation.defaultDesc' | 'resources.automation.fullAccessDesc'
  icon: React.ReactNode
  triggerIcon: React.ReactNode
  toneClass: string
  triggerToneClass: string
  hoverBg: string
  activeBg: string
}

export const codexPermissionPresetOptions: CodexPermissionPresetOption[] = [
  {
    id: 'read-only',
    labelKey: 'resources.automation.readOnly',
    descriptionKey: 'resources.automation.readOnlyDesc',
    icon: <Eye className="size-3.5" />,
    triggerIcon: <Eye className="size-3" />,
    toneClass: 'text-foreground',
    triggerToneClass: 'text-muted-foreground hover:bg-muted',
    hoverBg: 'hover:bg-accent',
    activeBg: 'bg-accent',
  },
  {
    id: 'default',
    labelKey: 'resources.automation.defaultValue',
    descriptionKey: 'resources.automation.defaultDesc',
    icon: <ShieldCheck className="size-3.5" />,
    triggerIcon: <ShieldCheck className="size-3" />,
    toneClass: 'text-foreground',
    triggerToneClass: 'text-muted-foreground hover:bg-muted',
    hoverBg: 'hover:bg-accent',
    activeBg: 'bg-accent',
  },
  {
    id: 'full-access',
    labelKey: 'resources.automation.fullAccess',
    descriptionKey: 'resources.automation.fullAccessDesc',
    icon: <AlertTriangle className="size-3.5" />,
    triggerIcon: <ShieldOff className="size-3" />,
    toneClass: 'text-destructive',
    triggerToneClass: 'text-destructive hover:bg-destructive/10',
    hoverBg: 'hover:bg-destructive/10',
    activeBg: 'bg-destructive/15',
  },
]

export function codexPermissionPresetOption(preset: CodexPermissionPreset): CodexPermissionPresetOption {
  return codexPermissionPresetOptions.find((option) => option.id === preset) ?? codexPermissionPresetOptions[1]
}

interface CodexPermissionPresetListProps {
  activePreset: CodexPermissionPreset
  /** Restrict the offered presets — callers that cannot carry every preset pass the reachable subset. */
  availablePresets?: CodexPermissionPreset[]
  onSelect: (preset: CodexPermissionPreset) => void
}

export function CodexPermissionPresetList({ activePreset, availablePresets, onSelect }: CodexPermissionPresetListProps) {
  const { t } = useTranslation()
  const visibleOptions = availablePresets
    ? codexPermissionPresetOptions.filter((option) => availablePresets.includes(option.id))
    : codexPermissionPresetOptions

  return (
    <>
      <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('chat.codex.permissionPreset')}</div>
      {visibleOptions.map((option) => (
        <button
          key={option.id}
          onClick={() => onSelect(option.id)}
          className={cn(
            'w-full rounded px-2 py-1.5 text-left text-xs transition-colors',
            option.id === activePreset ? option.activeBg : option.hoverBg,
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className={cn('inline-flex items-center gap-1.5 font-medium', option.toneClass)}>
                {option.icon}
                {t(option.labelKey)}
              </span>
              <span className="text-xs text-muted-foreground">{t(option.descriptionKey)}</span>
            </div>
            {option.id === activePreset && <Check className="mt-0.5 size-3.5 shrink-0" />}
          </div>
        </button>
      ))}
    </>
  )
}
