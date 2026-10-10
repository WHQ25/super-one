import { VOICE_READY_CUE_DURATION_MS, VOICE_READY_CUE_MIC_GUARD_MS } from '@superone/shared/voice-ready-cue'

type CuePlayer = Pick<typeof import('react-native-incall-manager').default, 'startRingback' | 'stopRingback'>

/** Existing native call player preserves receiver/speaker/headset routing. */
export function playNativeVoiceReadyCue(player: CuePlayer, guard: (on: boolean) => void): () => void {
  let ended = false
  let guardTimer: ReturnType<typeof setTimeout> | undefined
  let endTimer: ReturnType<typeof setTimeout> | undefined
  const end = () => {
    if (ended) return
    ended = true
    clearTimeout(guardTimer); clearTimeout(endTimer)
    try { player.stopRingback() } catch { /* cue failure must not disrupt the call */ }
    finally { guard(false) }
  }
  guard(true)
  try {
    player.startRingback('_BUNDLE_')
    guardTimer = setTimeout(() => guard(false), VOICE_READY_CUE_MIC_GUARD_MS)
    endTimer = setTimeout(end, VOICE_READY_CUE_DURATION_MS)
  } catch { end() }
  return end
}
