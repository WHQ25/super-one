import { useRef, useState } from 'react'
import type { DesktopUpgradeRequiredError } from '@superone/relay-client'

export interface DesktopUpgradeProblem { deviceName: string; pairingId: string; currentVersion?: string; minimumVersion: string }

/** An incompatible host stays paired; only an explicit retry or another device resumes work. */
export function useDesktopUpgrade(actions: { reconnect(pairingId: string): Promise<void>; dismiss(): Promise<void> }) {
  const [problem, setProblem] = useState<DesktopUpgradeProblem | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const generation = useRef(0)
  const pending = useRef<number | null>(null)
  const clear = () => { generation.current++; pending.current = null; setProblem(null); setBusy(false); setError(undefined) }
  return {
    problem, busy, error, clear,
    show: (cause: DesktopUpgradeRequiredError, deviceName: string, pairingId: string) => {
      generation.current++; pending.current = null; setBusy(false); setError(undefined)
      setProblem({ deviceName, pairingId, currentVersion: cause.host?.appVersion, minimumVersion: cause.minimumVersion })
    },
    reconnect: async () => {
      if (!problem || pending.current === generation.current) return
      const current = generation.current
      pending.current = current
      setBusy(true); setError(undefined)
      try { await actions.reconnect(problem.pairingId); if (generation.current === current) clear() }
      catch (cause) { if (generation.current === current) setError(cause instanceof Error ? cause.message : 'Could not reconnect. Please try again.') }
      finally { if (pending.current === current) pending.current = null; if (generation.current === current) setBusy(false) }
    },
    dismiss: async () => { clear(); await actions.dismiss() },
  }
}
