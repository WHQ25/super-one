/** The desktop chord is also rendered into the phone's bundled native cue. */
export interface VoiceReadyPart {
  frequency: number; startAt: number; duration: number; gain: number
  pan: number; attack: number; vibratoHz: number
}
export const VOICE_READY_CUE: VoiceReadyPart[] = [
  { frequency: 146.83, startAt: 0, duration: 2.2, gain: 0.075, pan: 0, attack: 0.18, vibratoHz: 4.3 },
  { frequency: 220, startAt: 0.04, duration: 2.2, gain: 0.055, pan: -0.3, attack: 0.2, vibratoHz: 4.9 },
  { frequency: 293.66, startAt: 0.08, duration: 2.2, gain: 0.05, pan: 0.28, attack: 0.22, vibratoHz: 5.4 },
  { frequency: 369.99, startAt: 0.13, duration: 2.2, gain: 0.038, pan: -0.18, attack: 0.24, vibratoHz: 4.6 },
  { frequency: 440, startAt: 0.18, duration: 2.2, gain: 0.032, pan: 0.34, attack: 0.26, vibratoHz: 5.1 },
]
export const VOICE_READY_CUE_REVERB_SECONDS = 2.6
/** Close capture around the loud onset so the cue cannot trigger remote VAD. */
export const VOICE_READY_CUE_MIC_GUARD_MS = Math.round(
  (Math.max(...VOICE_READY_CUE.map(voice => voice.startAt + voice.attack)) + 0.5) * 1000,
)
/** Includes the complete reverb tail; the asset adds silence beyond this stop time. */
export const VOICE_READY_CUE_DURATION_MS = Math.ceil(
  (Math.max(...VOICE_READY_CUE.map(voice => voice.startAt + voice.duration)) + VOICE_READY_CUE_REVERB_SECONDS) * 1000,
)
