import { useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { deriveOtaView, type OtaView } from './ota-update-state'
import { UPDATE_REENTRY_GUARD_MS } from './update-check-state'
// Type-only on purpose: a value import here would pull the native modules
// behind the ports into every jest suite that mounts the gate.
import type { OtaPorts } from './update-ports'

/**
 * Drive the JS-bundle update without asking the user anything.
 *
 * expo-updates already checks and downloads on launch; this hook watches that
 * lifecycle, shows it, and restarts onto the new bundle the moment it is on
 * disk -- otherwise the download would sit unused until the launch after
 * next. Coming back to the foreground re-checks, since the native side only
 * looks at launch and a phone that is never cold-started would otherwise
 * never see an update.
 */
export function useOtaUpdate(ports: OtaPorts): OtaView {
  const [native, setNative] = useState(() => ports.snapshot())
  const [reloadFailed, setReloadFailed] = useState(false)
  const reloading = useRef(false)
  const lastCheckAt = useRef<number | null>(null)

  useEffect(() => {
    if (!ports.enabled) return
    setNative(ports.snapshot())
    return ports.subscribe(setNative)
  }, [ports])

  useEffect(() => {
    if (!ports.enabled) return
    const check = () => {
      const now = Date.now()
      // The launch check is the native side's; JS only re-checks on a return
      // to the foreground, and not when that return is the app's own reload.
      if (lastCheckAt.current !== null && now - lastCheckAt.current < UPDATE_REENTRY_GUARD_MS) return
      lastCheckAt.current = now
      ports.checkAndFetch().catch(() => {
        // No network, or nothing published for this runtime: the next
        // foreground or launch tries again.
      })
    }
    lastCheckAt.current = Date.now()
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') check()
    })
    return () => subscription.remove()
  }, [ports])

  const view = deriveOtaView(native, reloadFailed)

  useEffect(() => {
    if (view.phase !== 'restarting' || reloading.current) return
    reloading.current = true
    ports.reload().catch(() => {
      // The bundle stays downloaded and applies on the next launch; drop the
      // gate rather than hold the app behind a restart that will not come.
      setReloadFailed(true)
    })
  }, [ports, view.phase])

  return view
}
