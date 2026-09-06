import { useSyncExternalStore } from 'react'
import { AccessibilityInfo, AppState } from 'react-native'

let reduced = true
let active = AppState.currentState === 'active'
const listeners = new Set<() => void>()
const publish = () => listeners.forEach((listener) => listener())
let dispose: (() => void) | undefined
function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    let alive = true
    active = AppState.currentState === 'active'
    AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (alive) { reduced = value; publish() } }).catch(() => {})
    const accessibility = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => { reduced = value; publish() })
    const lifecycle = AppState.addEventListener('change', (value) => { active = value === 'active'; publish() })
    dispose = () => { alive = false; accessibility.remove(); lifecycle.remove() }
  }
  return () => { listeners.delete(listener); if (!listeners.size) { dispose?.(); dispose = undefined } }
}

/** One OS subscription for the entire session list; no per-frame JS updates. */
export function useIconMotion() {
  return useSyncExternalStore(subscribe, () => active && !reduced, () => false)
}
