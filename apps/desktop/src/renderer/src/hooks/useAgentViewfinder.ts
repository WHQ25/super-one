import { useEffect } from 'react'
import {
  selectViewfinderOwner,
  useAgentViewfinderStore,
} from '@/stores/agent-viewfinder'

/**
 * Computer Use's half of the shared floating preview, and the only half that lives
 * outside the renderer.
 *
 * The device and browser previews report themselves from the components that draw
 * them, and stand down simply by not rendering. Computer Use cannot: its PiP is a
 * native macOS window, so this translates in both directions — main's claims become
 * store reports, and losing the arbitration becomes an instruction to hide.
 *
 * Mounted once, at the top of `App.tsx`, above every view branch. The arbitration has
 * to keep running while the user is in Settings, where neither of the other two
 * previews exists at all — otherwise a turn that ends there would leave the native
 * window suppressed with nothing to take its place.
 */
export function useAgentViewfinder(): void {
  useEffect(() => window.app.onComputerUseViewfinderClaim(({ active }) => {
    // Never pinned: the native window has no chrome the user could pin it by, so it
    // competes on recency alone — which is exactly right for a target the agent is
    // touching right now.
    useAgentViewfinderStore.getState().report('computer', { present: active })
  }), [])

  const owner = useAgentViewfinderStore(selectViewfinderOwner)
  useEffect(() => {
    // Yield only to a preview that actually won. `null` means nothing is on screen,
    // and suppressing the native window then would leave the user watching nothing.
    window.app.setComputerUseViewfinderYielded(owner !== null && owner !== 'computer')
  }, [owner])
}
