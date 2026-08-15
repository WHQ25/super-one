import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import type { CodexPermissionPreset, HarnessId, PermissionMode } from '@superone/shared/agent-types'
import { AcpPermissionModeList, acpPermissionModeOption } from './AcpPermissionModeList'
import { CodexPermissionPresetList, codexPermissionPresetOption } from './CodexPermissionPresetList'
import {
  CURSOR_PERMISSION_MODES,
  resolveCursorPermissionMode,
} from './cursorPermissionModes'
import { CursorPermissionModeList, cursorPermissionModeOption } from './CursorPermissionModeList'
import { OPENCODE_PERMISSION_MODES } from './opencodePermissionModes'
import { modes, PermissionModeList } from './PermissionModeList'

/**
 * A launch config carries a plain `PermissionMode`, so the Codex presets it can express are
 * exactly the ones `mapPermissionMode` (codex-backend) round-trips. `read-only` has no
 * `PermissionMode` spelling and is therefore not offered here.
 */
const CODEX_REACHABLE_PRESETS: CodexPermissionPreset[] = ['default', 'full-access']

function codexPresetOf(mode: PermissionMode): CodexPermissionPreset {
  return mode === 'bypassPermissions' || mode === 'acceptEdits' ? 'full-access' : 'default'
}

function modeOfCodexPreset(preset: CodexPermissionPreset): PermissionMode {
  return preset === 'full-access' ? 'bypassPermissions' : 'default'
}

interface Trigger {
  label: string
  icon: ReactNode
  toneClass: string
  content: ReactNode
  width: string
}

/**
 * Permission selector for a session that does not exist yet: same per-harness vocabulary the
 * status bar shows (`StatusBarPermission`), but driven by props instead of the active session.
 */
export function HarnessPermissionPopover({
  harnessId,
  value,
  onChange,
}: {
  harnessId: HarnessId
  value: PermissionMode
  onChange: (mode: PermissionMode) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const select = (mode: PermissionMode): void => {
    onChange(mode)
    setOpen(false)
  }

  let trigger: Trigger
  if (harnessId === 'codex') {
    const preset = codexPresetOf(value)
    const option = codexPermissionPresetOption(preset)
    trigger = {
      label: t(option.labelKey),
      icon: option.triggerIcon,
      toneClass: option.triggerToneClass,
      width: 'w-72',
      content: (
        <CodexPermissionPresetList
          activePreset={preset}
          availablePresets={CODEX_REACHABLE_PRESETS}
          onSelect={(next) => select(modeOfCodexPreset(next))}
        />
      ),
    }
  } else if (harnessId === 'acp') {
    const option = acpPermissionModeOption(value)
    trigger = {
      label: t(`chat.acpPermissionModes.${option.labelKey}.label`),
      icon: option.icon,
      toneClass: `${option.color} ${option.hoverBg}`,
      width: 'w-56',
      content: <AcpPermissionModeList activeMode={option.id} onSelect={select} />,
    }
  } else if (harnessId === 'cursor') {
    const mode = resolveCursorPermissionMode(value)
    const option = cursorPermissionModeOption(mode)
    trigger = {
      label: t(`chat.cursorPermissionModes.${option.labelKey}.label`),
      icon: option.icon,
      toneClass: `${option.color} ${option.hoverBg}`,
      width: 'w-56',
      content: (
        <CursorPermissionModeList
          activeMode={mode}
          availableModes={CURSOR_PERMISSION_MODES}
          onSelect={select}
        />
      ),
    }
  } else {
    // Claude offers every mode; OpenCode only the subset its backend implements.
    const availableModes = harnessId === 'opencode' ? OPENCODE_PERMISSION_MODES : modes.map((mode) => mode.id)
    const active = modes.find((mode) => mode.id === value && availableModes.includes(mode.id)) ?? modes[0]
    trigger = {
      label: t(`chat.permissionModes.${active.id}.label`),
      icon: active.icon,
      toneClass: `${active.color} ${active.hoverBg}`,
      width: 'w-52',
      content: <PermissionModeList activeMode={active.id} availableModes={availableModes} onSelect={select} />,
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors ${trigger.toneClass}`}
          title={trigger.label}
        >
          {trigger.icon}
          <span>{trigger.label}</span>
          <ChevronDown className={`size-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className={`${trigger.width} border-border bg-popover p-1`}>
        {trigger.content}
      </PopoverContent>
    </Popover>
  )
}
