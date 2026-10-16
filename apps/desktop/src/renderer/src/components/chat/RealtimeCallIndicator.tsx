import { useTranslation } from 'react-i18next'
import { realtimeVoiceAudioLevels, useRealtimeCallStore, type RealtimeCallState } from '@/stores/realtime-call'
import { VoiceWaveform } from './VoiceWaveform'

/** Status occupies the middle of the call bar; live speech belongs in the transcript. */
export function RealtimeCallIndicator({ frozenState }: { frozenState?: RealtimeCallState } = {}) {
  const { t } = useTranslation()
  const liveState = useRealtimeCallStore(store => store.state)
  const paused = useRealtimeCallStore(store => store.paused)
  const pauseReason = useRealtimeCallStore(store => store.pauseReason)
  const muted = useRealtimeCallStore(store => store.microphoneMuted)
  const state = liveState === 'idle' && frozenState ? frozenState : liveState
  if (state === 'idle') return null
  const active = state === 'active' && liveState !== 'idle'
  const label = t(!active
    ? state === 'starting' ? 'chat.realtimeVoice.starting' : 'chat.realtimeVoice.stopping'
    : paused ? pauseReason === 'interrupted' ? 'chat.realtimeVoice.interrupted' : 'chat.realtimeVoice.paused'
    : muted ? 'chat.realtimeVoice.microphoneMuted' : 'chat.realtimeVoice.waiting')
  return <div data-testid="realtime-call-indicator" className="flex h-8 min-w-0 flex-1 flex-col justify-center"
    role={active ? 'img' : 'status'} aria-label={label}>
    {active ? <>
      <VoiceWaveform levels={realtimeVoiceAudioLevels} paused={paused} />
      {paused && <span role="status" className="-mt-2 truncate text-center text-[10px] text-muted-foreground" title={label}>{label}</span>}
    </> : <span className="truncate text-center text-xs text-muted-foreground" title={label}>{label}</span>}
  </div>
}
