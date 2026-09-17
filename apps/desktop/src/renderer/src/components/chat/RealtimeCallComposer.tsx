import { memo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useRealtimeCallStore, type RealtimeCallState } from '@/stores/realtime-call'
import { SessionDecisionPrompts } from './SessionDecisionPrompts'
import { RealtimeCallIndicator } from './RealtimeCallIndicator'
import { RealtimeCallControls } from './RealtimeCallControls'

/**
 * Composer stack for the voice view while a call runs.
 *
 * Voice has no text input: what the user says is the input. The stack keeps the
 * session-level decision prompts (a delegated Codex turn can still ask for
 * permission), the live call indicator, and — directly under the voice mark —
 * the call's own controls. Everything else in the ordinary composer (editor,
 * harness pickers, queue) belongs to the backing thread and returns with
 * `ChatComposerShell` once the call ends.
 */
export const RealtimeCallComposer = memo(function RealtimeCallComposer() {
  const { t } = useTranslation()
  const liveState = useRealtimeCallStore((store) => store.state)
  // After a hang-up the store is idle before this composer has slid out. Keep
  // rendering the last engaged state so the mark leaves the screen intact.
  const lastEngagedRef = useRef<RealtimeCallState>(liveState === 'idle' ? 'stopping' : liveState)
  if (liveState !== 'idle') lastEngagedRef.current = liveState
  const state = liveState === 'idle' ? lastEngagedRef.current : liveState
  const starting = state === 'starting'
  const stopping = state === 'stopping' || liveState === 'idle'

  return (
    <>
      <SessionDecisionPrompts />
      {/* Grows to the text composer's resting height (see ComposerSwitch `alignTo`):
          the mark sits where the editor's top edge was, the controls at its foot. */}
      <div
        data-testid="realtime-call-composer"
        data-call-state={state}
        className="flex flex-1 flex-col items-center justify-between gap-1.5 px-3 pb-3"
      >
        <RealtimeCallIndicator frozenState={state} />
        {/* The foot is one fixed-height line whatever it says. Adding a "hanging up"
            line under the controls grew the block by a line at the very moment the
            slot's height was about to be pinned for the exit — the mark nudged up,
            then the settle brought it back down. */}
        <div className="flex h-6 items-center justify-center gap-1.5" aria-live="polite">
          {starting ? (
            // Negotiation has nothing to mute yet; the timeout in the store is the only way out.
            <span className="text-xs text-muted-foreground">{t('chat.realtimeVoice.connecting')}</span>
          ) : stopping ? (
            <span className="text-xs text-muted-foreground">{t('chat.realtimeVoice.stopping')}</span>
          ) : (
            <div data-testid="realtime-call-controls" className="flex items-center gap-1.5">
              <RealtimeCallControls layout="centered" />
            </div>
          )}
        </div>
      </div>
    </>
  )
})
