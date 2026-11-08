import { useEffect, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Pause, Play, Square, Volume2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  bindSpeechCacheCleared,
  messageHasSavedSpeech,
  pauseSpeaking,
  playSavedSpeech,
  rememberSavedSpeech,
  resumeSpeaking,
  speakMessage,
  speechPlaybackSnapshot,
  stopSpeaking,
  subscribeSavedSpeech,
  subscribeSpeechPlayback,
} from './speech-playback'

const iconClass = 'size-3'
const buttonClass = 'cursor-pointer transition-colors hover:text-foreground'

/** Read an assistant reply aloud, then pause, stop, or replay the saved audio. */
export function SpeakReplyButton({ messageId, text }: { messageId: string; text: string }) {
  const { t } = useTranslation()
  const playback = useSyncExternalStore(subscribeSpeechPlayback, speechPlaybackSnapshot, speechPlaybackSnapshot)
  const saved = useSyncExternalStore(subscribeSavedSpeech, () => messageHasSavedSpeech(messageId), () => false)
  const mine = playback.messageId === messageId
  const loading = mine && playback.phase === 'loading'
  const playing = mine && playback.phase === 'playing'
  const paused = mine && playback.phase === 'paused'

  useEffect(() => {
    let live = true
    bindSpeechCacheCleared()
    void window.app.hasSavedSpeech?.(messageId).then((yes) => {
      if (live && yes) rememberSavedSpeech(messageId)
    })
    return () => { live = false }
  }, [messageId])

  const speak = async () => {
    const result = await speakMessage(messageId, text)
    if (!result) return
    if (!result.ok) {
      if (!result.cancelled) toast.error(result.error || t('chat.messageMenu.speakFailed'))
      return
    }
    if (result.truncated) toast.message(t('chat.messageMenu.speakTruncated'))
  }

  const replay = async () => {
    const result = await playSavedSpeech(messageId)
    if (result && !result.ok) toast.error(result.error || t('chat.messageMenu.speakFailed'))
  }

  if (loading) {
    return (
      <button type="button" aria-label={t('chat.messageMenu.stopSpeaking')} onClick={stopSpeaking} className={buttonClass}>
        <Loader2 className={`${iconClass} animate-spin`} />
      </button>
    )
  }

  if (playing || paused) {
    return (
      <>
        <button
          type="button"
          aria-label={paused ? t('chat.messageMenu.resumeSpeaking') : t('chat.messageMenu.pauseSpeaking')}
          onClick={paused ? resumeSpeaking : pauseSpeaking}
          className={buttonClass}
        >
          {paused ? <Play className={iconClass} /> : <Pause className={iconClass} />}
        </button>
        <button type="button" aria-label={t('chat.messageMenu.stopSpeaking')} onClick={stopSpeaking} className={buttonClass}>
          <Square className={iconClass} />
        </button>
      </>
    )
  }

  if (saved) {
    return (
      <button type="button" aria-label={t('chat.messageMenu.playSaved')} onClick={() => { void replay() }} className={buttonClass}>
        <Volume2 className={iconClass} />
      </button>
    )
  }

  return (
    <button type="button" aria-label={t('chat.messageMenu.speak')} onClick={() => { void speak() }} className={buttonClass}>
      <Volume2 className={iconClass} />
    </button>
  )
}
