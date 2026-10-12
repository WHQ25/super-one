import type { CodexPermissionPreset, PermissionMode } from '@superone/shared/agent-types'
import { CodexPermissionPresetList, codexPermissionPresetOption } from '@/components/chat/CodexPermissionPresetList'
import { CodexPermissionSelector } from '@/components/chat/CodexPermissionSelector'
import { CodexModelSelector } from '@/components/chat/model-selector/CodexModelSelector'
import type { HarnessControls } from '../controls'

/**
 * A launch config carries a plain `PermissionMode`, so the Codex presets it can express are
 * exactly the ones `mapPermissionMode` (codex-backend) round-trips. `read-only` has no
 * `PermissionMode` spelling and is therefore not offered here.
 */
const LAUNCH_PRESETS: CodexPermissionPreset[] = ['default', 'auto-review', 'full-access']

function presetOf(mode: PermissionMode): CodexPermissionPreset {
  if (mode === 'auto') return 'auto-review'
  return mode === 'bypassPermissions' || mode === 'acceptEdits' ? 'full-access' : 'default'
}

function modeOf(preset: CodexPermissionPreset): PermissionMode {
  if (preset === 'auto-review') return 'auto'
  return preset === 'full-access' ? 'bypassPermissions' : 'default'
}

export const codexControls: HarnessControls = {
  ModelControl: CodexModelSelector,
  PermissionControl: CodexPermissionSelector,
  launchPermission: (value, select) => {
    const preset = presetOf(value)
    const option = codexPermissionPresetOption(preset)
    return {
      labelKey: option.labelKey,
      icon: option.triggerIcon,
      toneClass: option.triggerToneClass,
      content: (
        <CodexPermissionPresetList
          activePreset={preset}
          availablePresets={LAUNCH_PRESETS}
          onSelect={(next) => select(modeOf(next))}
        />
      ),
    }
  },
}
