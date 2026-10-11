import { MobileVoiceControls, MobileVoiceEntry, MobileVoiceReturnEntry } from './mobile-voice-controls'
import type { useMobileVoice } from './use-mobile-voice'
import type { VoiceTarget } from './voice-service'
import { VOICE_SESSION_BUSY_REASON } from '@superone/shared/realtime-voice'

/** Give React a committed frame before native peer/capture teardown can block JS. */
export function afterVoiceUiPaint(cleanup: () => void): void {
  let done = false
  const finish = () => { if (!done) { done = true; clearTimeout(fallback); cleanup() } }
  const fallback = setTimeout(finish, 100)
  requestAnimationFrame(() => requestAnimationFrame(finish))
}

export function voicePresentation(input: {
  voice: ReturnType<typeof useMobileVoice>
  connected: boolean; sessionId: string | null; projectPath?: string; routed: boolean
  streaming?: boolean
  view: 'realtime' | 'thread'
  onStart: () => void; onReturn: (target: VoiceTarget) => void; onSettings: () => void
}) {
  const { voice, onStart, onReturn, onSettings } = input
  const { state, service } = voice
  const busy = state.phase === 'starting' || state.phase === 'active' || state.phase === 'stopping'
  const same = !input.routed && state.target?.sessionId === input.sessionId && state.target?.projectPath === input.projectPath
  const controls = state.phase === 'idle' ? undefined : <MobileVoiceControls state={state} audioLevels={service.audioLevels}
    onStop={() => service.stop(afterVoiceUiPaint)} onInputMute={() => service.muteInput()} onPlayback={() => { void service.togglePlayback() }} onRetry={voice.retry} onSettings={onSettings} />
  const entry = busy && state.target ? <MobileVoiceReturnEntry paused={state.paused} audioLevels={service.audioLevels} onReturn={() => onReturn(state.target!)} />
    : voice.capability?.supported ? <MobileVoiceEntry disabledReason={!input.connected ? 'Keep the desktop online.' : input.streaming ? VOICE_SESSION_BUSY_REASON : undefined}
      enabled={voice.supported && input.connected && !input.streaming} busy={busy} onStart={onStart} /> : undefined
  return { composer: same && input.view === 'realtime' ? controls : undefined, entry, controls }
}
