export type VoiceAudioLevels = Readonly<{ input: number; output: number }>
export const SILENT_VOICE_LEVELS: VoiceAudioLevels = { input: 0, output: 0 }
export type VoiceAudioLevelSource = {
  snapshot(): VoiceAudioLevels
  subscribe(listener: (levels: VoiceAudioLevels) => void): () => void
}
const clamp = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0

/** Separate from call/React state: meter samples never rerender the chat tree. */
export class VoiceAudioLevelStore implements VoiceAudioLevelSource {
  private levels = SILENT_VOICE_LEVELS
  private listeners = new Set<(levels: VoiceAudioLevels) => void>()
  snapshot = (): VoiceAudioLevels => this.levels
  subscribe = (listener: (levels: VoiceAudioLevels) => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  publish(levels: VoiceAudioLevels): void {
    const next = { input: clamp(levels.input), output: clamp(levels.output) }
    if (next.input === this.levels.input && next.output === this.levels.output) return
    this.levels = next
    for (const listener of this.listeners) listener(next)
  }
}

type Energy = { energy: number; duration: number }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

/** Native WebRTC's media-source is capture; inbound-rtp is decoded remote audio. */
export class VoiceAudioStatsReader {
  private previous = new Map<string, Energy>()
  read(report: ReadonlyMap<string, unknown>): VoiceAudioLevels {
    let input = 0; let output = 0
    const next = new Map<string, Energy>()
    for (const [id, raw] of report) {
      if (!raw || typeof raw !== 'object') continue
      const stat = raw as Record<string, unknown>
      if ((stat.kind ?? stat.mediaType) !== 'audio' || (stat.type !== 'media-source' && stat.type !== 'inbound-rtp')) continue
      let level = finite(stat.audioLevel) ? clamp(stat.audioLevel) : 0
      if (finite(stat.totalAudioEnergy) && finite(stat.totalSamplesDuration)) {
        const current = { energy: stat.totalAudioEnergy, duration: stat.totalSamplesDuration }
        next.set(id, current)
        const previous = this.previous.get(id)
        if (previous && current.energy >= previous.energy && current.duration >= previous.duration) {
          const duration = current.duration - previous.duration
          // Interval RMS, not a lifetime average; a stalled stream goes quiet.
          level = duration > 0 ? clamp(Math.sqrt((current.energy - previous.energy) / duration)) : 0
        }
      }
      if (stat.type === 'media-source') input = Math.max(input, level)
      else output = Math.max(output, level)
    }
    this.previous = next
    return { input, output }
  }
}

/** One in-flight native stats read, at most 10 Hz, using the existing peer. */
export function monitorVoiceAudioLevels(peer: { getStats(): Promise<ReadonlyMap<string, unknown>> }, publish: (levels: VoiceAudioLevels) => void): () => void {
  const reader = new VoiceAudioStatsReader()
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let stale: ReturnType<typeof setTimeout> | undefined
  const sample = async () => {
    stale = setTimeout(() => { if (!stopped) publish(SILENT_VOICE_LEVELS) }, 300)
    try {
      const report = await peer.getStats()
      if (!stopped) publish(reader.read(report))
    } catch { if (!stopped) publish(SILENT_VOICE_LEVELS) }
    finally {
      clearTimeout(stale)
      if (!stopped) timer = setTimeout(() => { void sample() }, 100)
    }
  }
  void sample()
  return () => {
    stopped = true; clearTimeout(timer); clearTimeout(stale)
    publish(SILENT_VOICE_LEVELS)
  }
}
