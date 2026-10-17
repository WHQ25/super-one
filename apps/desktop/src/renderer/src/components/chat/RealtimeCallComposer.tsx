import { memo, useRef } from 'react'
import { useRealtimeCallStore, type RealtimeCallState } from '@/stores/realtime-call'
import { RealtimeCallIndicator } from './RealtimeCallIndicator'
import { RealtimeCallControls } from './RealtimeCallControls'

/** Phone control order, with a bounded, centered bar for wide desktop panes. */
export const RealtimeCallComposer = memo(function RealtimeCallComposer({ microphoneShortcutEnabled = true, onPlayback, onStop }: {
  microphoneShortcutEnabled?: boolean; onPlayback?: () => void; onStop?: () => void
}) {
  const liveState = useRealtimeCallStore(store => store.state)
  // ComposerSwitch retains the outgoing surface until its exit finishes.
  const lastEngagedRef = useRef<RealtimeCallState>(liveState === 'idle' ? 'stopping' : liveState)
  if (liveState !== 'idle') lastEngagedRef.current = liveState
  const state = liveState === 'idle' ? lastEngagedRef.current : liveState
  return <div className="flex flex-1 items-end justify-center px-3 pb-2 pt-1">
    <div data-testid="realtime-call-composer" data-call-state={state}
      className="flex min-h-11 w-full max-w-lg items-center gap-1 rounded-2xl border border-border bg-background px-2 py-1 @lg:gap-3 @lg:px-3">
      <RealtimeCallControls layout="composer" disabled={liveState !== 'active'}
        hangUpDisabled={liveState === 'stopping' || liveState === 'idle'}
        onPlayback={onPlayback} onStop={onStop}
        microphoneShortcutEnabled={microphoneShortcutEnabled}>
        <RealtimeCallIndicator frozenState={state} />
      </RealtimeCallControls>
    </div>
  </div>
})
