import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CODEX_PERMISSION_PRESETS,
  DEFAULT_CODEX_PERMISSION_PRESET,
  type SandboxInfo,
  type SandboxMode,
} from '@superone/shared/agent-types'
import { useActiveSession, type ChatProvider } from '@/stores/chat'
import { sandboxModes } from '../SandboxModeSelector'
import { deepseekPermissionModeMeta } from '../deepseekPermissionModes'

/**
 * Sandbox state for harnesses with no toggle of their own — display-only, because
 * there is nothing here the user can set. Three shapes:
 *
 * - Codex / dsh fold a sandbox mode into their permission setting. An independent
 *   toggle could contradict that setting, which is why `harnessSupportsSandbox`
 *   stays false for them; the state is read out of the setting instead.
 * - ACP (Grok) has a real OS-level sandbox that SuperOne does not drive — Grok
 *   reads it from its own env/config at process start. So it is *observed* over
 *   IPC rather than assumed, otherwise the chip would claim `off` while Grok is
 *   actually confined.
 * - OpenCode has no sandbox mechanism at all, so `off` is the standing answer.
 *
 * Only on/off/auto is claimed. Codex, dsh and Grok all have finer vocabularies,
 * but that detail already shows in the permission chip next door.
 */
function sandboxModeFrom(info: SandboxInfo): SandboxMode {
  if (!info.enabled) return 'off'
  return info.autoAllowBash ? 'auto' : 'on'
}

/**
 * Grok applies its sandbox once at startup and cannot change it afterwards
 * (irreversible by design), so a single read per mount is the whole story — there
 * is no live value to subscribe to.
 */
function useObservedAcpSandbox(enabled: boolean): SandboxMode {
  const [mode, setMode] = useState<SandboxMode>('off')

  useEffect(() => {
    if (!enabled) return
    let alive = true
    window.app.acpGetSandbox()
      .then((info) => { if (alive) setMode(sandboxModeFrom(info)) })
      // Report off rather than a guess — the same answer as no sandbox configured.
      .catch(() => { if (alive) setMode('off') })
    return () => { alive = false }
  }, [enabled])

  return mode
}

function useSandboxState(activeProvider: ChatProvider): SandboxMode {
  // Each branch reads the same store field that harness's permission chip reads,
  // so the two chips in the bar cannot disagree.
  const codexPreset = useActiveSession((s) => s.selectedCodexPermissionPreset)
  const permissionMode = useActiveSession((s) => s.permissionMode)
  const observedAcp = useObservedAcpSandbox(activeProvider === 'acp')

  // Codex and dsh happen to share one vocabulary, so one comparison serves both.
  // dsh's renderer-side map is used deliberately — `dshPresetForMode` lives in
  // dsh's runtime, which must stay out of this bundle.
  if (activeProvider === 'codex') {
    const { sandboxMode } = CODEX_PERMISSION_PRESETS[codexPreset || DEFAULT_CODEX_PERMISSION_PRESET]
    return sandboxMode === 'danger-full-access' ? 'off' : 'on'
  }
  if (activeProvider === 'dsh') {
    return deepseekPermissionModeMeta(permissionMode).preset === 'danger-full-access' ? 'off' : 'on'
  }
  if (activeProvider === 'acp') return observedAcp
  return 'off'
}

export function StatusBarDerivedSandbox({
  activeProvider,
  compactIndicators,
}: {
  activeProvider: ChatProvider
  compactIndicators: boolean
}) {
  const { t } = useTranslation()
  const id = useSandboxState(activeProvider)
  const mode = sandboxModes.find((m) => m.id === id) ?? sandboxModes[1]
  const label = t(`chat.sandboxModes.${mode.id}.label`)

  return (
    <span
      className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs ${mode.color}`}
      title={label}
      aria-label={label}
    >
      {mode.icon}
      {!compactIndicators && <span>{mode.triggerLabel}</span>}
    </span>
  )
}
