import { Pressable, View } from 'react-native'
import { useState } from 'react'
import { MobileThemeProvider } from '../theme/context'
import { MobileVoiceGallery, usePreviewVoiceAudio } from './voice-preview'
import { MobileVoiceControls, MobileVoiceEntry, MobileVoiceReturnEntry } from './mobile-voice-controls'
import type { MobileVoiceState } from './voice-service'
import { Text } from '../ui/text'

function InteractiveControls({ light = false, input = 0.11, output = 0, muted = false }: { light?: boolean; input?: number; output?: number; muted?: boolean }) {
  const initial: MobileVoiceState = { phase: 'active', target: { sessionId: 'offline', projectPath: '/repo' }, inputMuted: muted, paused: false, pauseReason: null, resuming: false, error: null }
  const [state, setState] = useState(initial)
  const audioLevels = usePreviewVoiceAudio(state.phase === 'active' && !state.inputMuted ? input : 0, state.phase === 'active' ? output : 0)
  return <MobileThemeProvider colorScheme={light ? 'light' : 'dark'} locale="zh"><View style={{ width: 320 }}>
    {state.phase === 'idle' ? <MobileVoiceEntry enabled busy={false} onStart={() => setState(initial)} /> :
      <MobileVoiceControls state={state} audioLevels={audioLevels} onStop={() => setState({ ...state, phase: 'idle' })}
        onInputMute={() => setState({ ...state, inputMuted: !state.inputMuted })} onPlayback={() => setState({ ...state, paused: !state.paused, pauseReason: state.paused ? null : 'manual' })}
        onRetry={() => setState(initial)} onSettings={() => {}} />}
  </View></MobileThemeProvider>
}
export default { title: 'Mobile/Voice', component: MobileVoiceGallery }
export const States = { render: () => <MobileThemeProvider><View style={{ width: 390, height: 1000 }}><MobileVoiceGallery /></View></MobileThemeProvider> }
export const Narrow = { render: () => <MobileThemeProvider><View style={{ width: 320, height: 700 }}><MobileVoiceGallery /></View></MobileThemeProvider> }
export const LightChinese = { render: () => <MobileThemeProvider colorScheme="light" locale="zh"><View style={{ width: 320, height: 700 }}><MobileVoiceGallery /></View></MobileThemeProvider> }
export const ControlsOnly = { name: 'Thin rainbow · microphone input', render: () => <InteractiveControls /> }
export const LightControlsOnly = { name: 'Three controls · narrow light Chinese', render: () => <InteractiveControls light /> }
export const AgentPlayback = { render: () => <InteractiveControls input={0} output={0.14} /> }
export const MutedAgentPlayback = { render: () => <InteractiveControls muted output={0.14} /> }
export const SimultaneousAudio = { render: () => <InteractiveControls input={0.08} output={0.12} /> }
export const Silence = { render: () => <InteractiveControls input={0} /> }

function EntryAvailability({ light = false }: { light?: boolean }) {
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  return <MobileThemeProvider colorScheme={light ? 'light' : 'dark'} locale={light ? 'zh' : 'en'}><View style={{ width: 320, gap: 12 }}>
    <Pressable accessibilityRole="button" onPress={() => setEnabled(!enabled)}><Text>Supported: {String(enabled)} · toggle</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => setBusy(!busy)}><Text>Task running: {String(busy)} · toggle</Text></Pressable>
    <View style={{ flexDirection: 'row', alignItems: 'center' }}><MobileVoiceEntry enabled={enabled} busy={busy} onStart={() => setBusy(true)} /><Text>Message composer</Text></View>
  </View></MobileThemeProvider>
}
export const StartAvailability = { name: 'Start entry · hide when unavailable', render: () => <EntryAvailability /> }
export const StartAvailabilityLightChinese = { render: () => <EntryAvailability light /> }

function ReturnToVoice({ light = false }: { light?: boolean }) {
  const [view, setView] = useState<'thread' | 'voice'>('thread')
  const audioLevels = usePreviewVoiceAudio(0.08, 0.12)
  const state: MobileVoiceState = { phase: 'active', target: { sessionId: 'offline', projectPath: '/repo' }, inputMuted: false, paused: false, pauseReason: null, resuming: false, error: null }
  return <MobileThemeProvider colorScheme={light ? 'light' : 'dark'} locale="zh"><View style={{ width: 320 }}>
    {view === 'thread' ? <MobileVoiceReturnEntry audioLevels={audioLevels} onReturn={() => setView('voice')} />
      : <MobileVoiceControls state={state} audioLevels={audioLevels} onStop={() => setView('thread')} onInputMute={() => {}} onPlayback={() => {}} onRetry={() => {}} onSettings={() => {}} />}
  </View></MobileThemeProvider>
}
export const CompactReturn = { name: 'Return to live voice · circular waveform', render: () => <ReturnToVoice /> }
export const CompactReturnLight = { render: () => <ReturnToVoice light /> }
