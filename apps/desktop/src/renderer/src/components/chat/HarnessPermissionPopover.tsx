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
import { DEEPSEEK_PERMISSION_MODES } from './deepseekPermissionModes'
import { OPENCODE_PERMISSION_MODES } from './opencodePermissionModes'
import { modes, PermissionModeList } from './PermissionModeList'
import { PERMISSION_POPOVER_CLASS } from './permissionPopoverStyles'

/**
 * A launch config carries a plain `PermissionMode`, so the Codex presets it can express are
 * exactly the ones `mapPermissionMode` (codex-backend) round-trips. `read-only` has no
 * `PermissionMode` spelling and is therefore not offered here.
 */
const CODEX_REACHABLE_PRESETS: CodexPermissionPreset[] = ['default', 'auto-review', 'full-access']

function codexPresetOf(mode: PermissionMode): CodexPermissionPreset {
  if (mode === 'auto') return 'auto-review'
  return mode === 'bypassPermissions' || mode === 'acceptEdits' ? 'full-access' : 'default'
}

function modeOfCodexPreset(preset: CodexPermissionPreset): PermissionMode {
  if (preset === 'auto-review') return 'auto'
  return preset === 'full-access' ? 'bypassPermissions' : 'default'
}

interface Trigger {
  label: string
  icon: ReactNode
  toneClass: string
  content: ReactNode
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
      content: <AcpPermissionModeList activeMode={option.id} onSelect={select} />,
    }
  } else if (harnessId === 'cursor') {
    const mode = resolveCursorPermissionMode(value)
    const option = cursorPermissionModeOption(mode)
    trigger = {
      label: t(`chat.cursorPermissionModes.${option.labelKey}.label`),
      icon: option.icon,
      toneClass: `${option.color} ${option.hoverBg}`,
      content: (
        <CursorPermissionModeList
          activeMode={mode}
          availableModes={CURSOR_PERMISSION_MODES}
          onSelect={select}
        />
      ),
    }
  } else {
    // Claude offers every mode; OpenCode/DeepSeek only the subset their backends implement.
    const availableModes = harnessId === 'opencode'
      ? OPENCODE_PERMISSION_MODES
      : harnessId === 'dsh'
        ? DEEPSEEK_PERMISSION_MODES
        : modes.map((mode) => mode.id)
    const active = modes.find((mode) => mode.id === value && availableModes.includes(mode.id)) ?? modes[0]
    trigger = {
      label: t(`chat.permissionModes.${active.id}.label`),
      icon: active.icon,
      toneClass: `${active.color} ${active.hoverBg}`,
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
      <PopoverContent align="start" side="top" className={PERMISSION_POPOVER_CLASS}>
        {trigger.content}
      </PopoverContent>
    </Popover>
  )
}
