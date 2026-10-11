import { ScrollView, View } from 'react-native'
import { useMemo } from 'react'
import { Text } from '../ui/text'
import { MobileVoiceControls, MobileVoiceEntry, MobileVoiceReturnEntry } from './mobile-voice-controls'
import { useMobileTheme } from '../theme/context'
import type { MobileVoiceState } from './voice-service'
import { VoiceAudioLevelStore, type VoiceAudioLevels } from './voice-audio-levels'

const base: MobileVoiceState = { phase: 'starting', target: { projectPath: '/repo', sessionId: 'voice-task', title: 'Review the login flow', harnessId: 'codex' }, inputMuted: false, paused: false, pauseReason: null, resuming: false, error: null }
const cases: Array<[string, Partial<MobileVoiceState>, VoiceAudioLevels]> = [
  ['Starting · text only', {}, { input: 0, output: 0 }],
  ['Connected · silence', { phase: 'active' }, { input: 0, output: 0 }],
  ['Microphone audio', { phase: 'active' }, { input: 0.11, output: 0 }],
  ['Agent audio', { phase: 'active' }, { input: 0, output: 0.14 }],
  ['Input and output', { phase: 'active' }, { input: 0.08, output: 0.12 }],
  ['Microphone muted · agent audio', { phase: 'active', inputMuted: true }, { input: 0, output: 0.14 }],
  ['Paused', { phase: 'active', paused: true, pauseReason: 'manual' }, { input: 0.11, output: 0.14 }],
  ['Audio interrupted', { phase: 'active', paused: true, pauseReason: 'interrupted' }, { input: 0.11, output: 0.14 }],
  ['Resume unavailable', { phase: 'active', paused: true, pauseReason: 'interrupted', error: 'Audio is still interrupted. Try again when the other call ends.' }, { input: 0, output: 0 }],
  ['Stopping', { phase: 'stopping' }, { input: 0, output: 0 }],
  ['Permission denied', { phase: 'denied', error: 'Microphone access denied. Enable it in Settings.' }, { input: 0, output: 0 }],
  ['Disconnected', { phase: 'error', error: 'Desktop disconnected. Voice ended.' }, { input: 0, output: 0 }],
]
const noop = () => {}
/** Fixed, explicit audio samples for offline stories; never acquires media. */
export function usePreviewVoiceAudio(input: number, output: number): VoiceAudioLevelStore {
  return useMemo(() => {
    const levels = new VoiceAudioLevelStore()
    levels.publish({ input, output })
    return levels
  }, [input, output])
}
function VoiceCase({ label, state, sample }: { label: string; state: MobileVoiceState; sample: VoiceAudioLevels }) {
  const { tokens: { colors } } = useMobileTheme()
  const audioLevels = usePreviewVoiceAudio(sample.input, sample.output)
  return <View style={{ gap: 4 }}>
    <Text style={{ color: colors.foreground }}>{label}</Text>
    <MobileVoiceControls state={state} audioLevels={audioLevels} onStop={noop} onInputMute={noop} onPlayback={noop} onRetry={noop} onSettings={noop} />
  </View>
}
export function MobileVoiceGallery() {
  const levels = usePreviewVoiceAudio(0.11, 0.14)
  return <ScrollView contentContainerStyle={{ padding: 12, gap: 16 }}>
    <View style={{ flexDirection: 'row', gap: 12 }}><MobileVoiceEntry enabled busy={false} onStart={noop} /><MobileVoiceEntry enabled={false} busy={false} onStart={noop} /><MobileVoiceReturnEntry audioLevels={levels} onReturn={noop} /></View>
    <MobileVoiceEntry enabled={false} busy={false} onStart={noop} disabledReason="A task is running. Start voice when it finishes." />
    {cases.map(([label, patch, sample]) => <VoiceCase key={label} label={label} state={{ ...base, ...patch }} sample={sample} />)}
  </ScrollView>
}
