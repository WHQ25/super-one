import { useCallback, useEffect, useRef, useState } from 'react'
import type { CodexVoicePreviews } from '@superone/shared/codex-voice-previews'

export function useCodexVoicePreviews(open: boolean, disabled: boolean, language: string, projectPath: string | null) {
  const [voices, setVoices] = useState<CodexVoicePreviews>({})
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [playError, setPlayError] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)
  const [buffering, setBuffering] = useState(false)
  const [retry, setRetry] = useState(0)
  const context = `${language}\0${projectPath ?? ''}`
  const [loadedContext, setLoadedContext] = useState<string | null>(null)
  const ready = loadedContext === context
  const player = useRef<HTMLAudioElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const audio = player.current
    player.current = null
    if (audio) {
      audio.onended = null
      audio.onerror = null
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    setPlaying(null)
    setBuffering(false)
  }, [])

  // Prepare grouping before opening; closing the picker only stops playback.
  useEffect(() => {
    let current = true
    setVoices({})
    setLoading(true)
    setLoadError(false)
    setPlayError(false)
    window.app.codexListRealtimeVoicePreviews(language)
      .then((result) => { if (current) setVoices(result) })
      .catch(() => { if (current) setLoadError(true) })
      .finally(() => {
        if (current) { setLoading(false); setLoadedContext(context) }
      })
    return () => { current = false }
  }, [language, projectPath, context, retry])

  useEffect(() => {
    stop()
    setPlayError(false)
    return stop
  }, [open, disabled, language, projectPath, stop])

  const toggle = useCallback((voice: string) => {
    const wasPlaying = playing === voice
    stop()
    setPlayError(false)
    const url = voices[voice]?.previewUrl
    if (wasPlaying || !open || disabled || !ready || !url) return
    const audio = new Audio(url)
    player.current = audio
    setPlaying(voice)
    setBuffering(true)
    const fail = () => {
      if (player.current !== audio) return
      stop()
      setPlayError(true)
    }
    audio.onended = () => { if (player.current === audio) stop() }
    audio.onerror = fail
    timer.current = setTimeout(fail, 15_000)
    try {
      void audio.play().then(() => {
        if (player.current !== audio) return
        if (timer.current) clearTimeout(timer.current)
        timer.current = null
        setBuffering(false)
      }).catch(fail)
    } catch { fail() }
  }, [playing, stop, open, disabled, ready, voices])

  return { voices, ready, loading, loadError, playError, playing, buffering, stop, toggle, reload: () => setRetry((value) => value + 1) }
}
