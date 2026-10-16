import { useEffect, type ReactNode } from 'react'
import { Mic, MicOff, Power, Pause, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CommandShortcut } from '@superone/ui/components/ui/command'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import {
  stopRealtimeCall,
  toggleRealtimeMicrophone,
  toggleRealtimePlayback,
  useRealtimeCallStore,
} from '@/stores/realtime-call'

interface RealtimeCallControlsProps {
  disabled?: boolean
  microphoneShortcutEnabled?: boolean
  layout?: 'toolbar' | 'composer'
  children?: ReactNode
  hangUpDisabled?: boolean
  onPlayback?: () => void
  onStop?: () => void
}

export function RealtimeCallControls({ disabled = false, layout = 'toolbar', children, hangUpDisabled = disabled, microphoneShortcutEnabled = false, onPlayback = () => { void toggleRealtimePlayback() }, onStop = () => { void stopRealtimeCall() } }: RealtimeCallControlsProps) {
  const { t } = useTranslation()
  const microphoneMuted = useRealtimeCallStore((store) => store.microphoneMuted)
  const paused = useRealtimeCallStore((store) => store.paused)
  const resuming = useRealtimeCallStore((store) => store.resuming)
  useEffect(() => {
    if (!microphoneShortcutEnabled || disabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing
        || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
        || event.key.toLowerCase() !== 'm'
        || useRealtimeCallStore.getState().state !== 'active') return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable
        || target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'))) return
      event.preventDefault()
      toggleRealtimeMicrophone()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [microphoneShortcutEnabled, disabled])

  const composer = layout === 'composer'
  const buttonClass = composer ? 'size-8 rounded-full text-foreground [&_svg:not([class*=size-])]:size-4' : undefined

  // A muted channel is a state the user should notice at a glance, so the icon
  // takes the error status color (not destructive: nothing is being deleted).
  const microphoneLabel = t(microphoneMuted
    ? 'chat.realtimeVoice.unmuteMicrophone'
    : 'chat.realtimeVoice.muteMicrophone')
  const microphone = (
    <IconButton
      key="microphone"
      size="sm"
      variant="ghost"
      disabled={disabled}
      aria-pressed={microphoneMuted}
      aria-keyshortcuts={microphoneShortcutEnabled ? 'M' : undefined}
      aria-label={microphoneLabel}
      tooltip={microphoneShortcutEnabled ? (
        <span className="inline-flex items-center gap-1.5">
          {microphoneLabel}<CommandShortcut className="tracking-normal">M</CommandShortcut>
        </span>
      ) : microphoneLabel}
      className={cn(buttonClass, microphoneMuted && 'text-error hover:text-error')}
      onClick={toggleRealtimeMicrophone}
    >
      {microphoneMuted ? <MicOff /> : <Mic />}
    </IconButton>
  )
  const playback = (
    <IconButton
      key="playback"
      size="sm"
      variant="ghost"
      disabled={disabled || resuming}
      aria-pressed={paused}
      aria-label={t(paused ? 'chat.realtimeVoice.resume' : 'chat.realtimeVoice.pause')}
      tooltip={t(paused ? 'chat.realtimeVoice.resume' : 'chat.realtimeVoice.pause')}
      className={buttonClass}
      onClick={onPlayback}
    >
      {paused ? <Play /> : <Pause />}
    </IconButton>
  )
  const hangUp = (
    <IconButton
      key="hang-up"
      size="sm"
      variant="ghost"
      disabled={hangUpDisabled}
      tooltip={t('chat.realtimeVoice.stop')}
      className={cn(
        'rounded-full bg-error text-white hover:bg-error/90 hover:text-white',
        composer && 'mx-1 size-7 [&_svg:not([class*=size-])]:size-3.5',
      )}
      onClick={onStop}
    >
      <Power />
    </IconButton>
  )

  return <>{microphone}{children}{playback}{hangUp}</>
}
