import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SandboxMode } from '@superone/shared/agent-types'
import { resolveSandboxMode, sandboxModeFromInfo } from '@superone/shared/harness/harness-sandbox'
import { useActiveSession, type ChatProvider } from '@/stores/chat'
import { sandboxModes } from '../SandboxModeSelector'

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
      .then((info) => { if (alive) setMode(sandboxModeFromInfo(info)) })
      // Report off rather than a guess — the same answer as no sandbox configured.
      .catch(() => { if (alive) setMode('off') })
    return () => { alive = false }
  }, [enabled])

  return mode
}

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
 *
 * The mapping itself lives in `@superone/shared` so Remote Control's chip cannot
 * report a different sandbox than this one for the same session.
 */
function useSandboxState(activeProvider: ChatProvider): SandboxMode {
  // Each branch reads the same store field that harness's permission chip reads,
  // so the two chips in the bar cannot disagree.
  const codexPreset = useActiveSession((s) => s.selectedCodexPermissionPreset)
  const permissionMode = useActiveSession((s) => s.permissionMode)
  const observedAcp = useObservedAcpSandbox(activeProvider === 'acp')

  if (activeProvider === 'acp') return observedAcp
  return resolveSandboxMode({
    harnessId: activeProvider,
    permissionMode,
    ...(activeProvider === 'codex' ? { codexPreset: codexPreset || null } : {}),
  })
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
