import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { SpeechVoiceCatalog, SpeechVoiceCatalogResult, SpeechVoicePreviewResult } from '@superone/shared/agent-types'
import { Button } from '@superone/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { Input } from '@superone/ui/components/ui/input'
import { cn } from '@superone/ui/lib/utils'
import { SettingsRow } from '@/components/settings/SettingsSection'
import { settingsSelectTriggerClassName } from '@/components/settings/select-trigger-class'
import { useSettingsStore } from '@/stores/settings'

function isCatalog(result: SpeechVoiceCatalogResult | undefined): result is SpeechVoiceCatalog {
  return !!result && 'voices' in result
}

/**
 * Voice for the speech provider read-aloud and speech_generate will use.
 * The choice is stored per credential. Transcription has no voice.
 */
export function SpeechVoiceRow() {
  const { t } = useTranslation()
  const bindings = useSettingsStore((s) => s.bindings)
  const credentials = useSettingsStore((s) => s.credentials)
  const boundId = bindings.find((binding) => binding.consumer === 'tts')?.credentialId ?? ''
  const [catalog, setCatalog] = useState<SpeechVoiceCatalog | null>(null)
  const [error, setError] = useState<'unconfigured' | 'failed' | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [draft, setDraft] = useState('')
  const [previewPhase, setPreviewPhase] = useState<'idle' | 'loading' | 'playing'>('idle')
  const previewAudio = useRef<HTMLAudioElement | null>(null)
  const previewSerial = useRef(0)

  useEffect(() => () => {
    previewSerial.current += 1
    previewAudio.current?.pause()
    previewAudio.current = null
  }, [])

  useEffect(() => {
    let current = true
    setLoading(true)
    window.app.listSpeechVoices()
      .then((result) => {
        if (!current) return
        if (isCatalog(result)) {
          setCatalog(result)
          setError(null)
          return
        }
        setCatalog(null)
        setError(result?.error === 'unconfigured' ? 'unconfigured' : 'failed')
      })
      .catch(() => {
        if (!current) return
        setCatalog(null)
        setError('failed')
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => { current = false }
  }, [attempt, boundId, credentials])

  const selected = catalog?.voices.find((voice) => voice.id === catalog.selectedVoice)
  const status = loading
    ? t('settings.general.speechVoice.loading')
    : error === 'unconfigured'
      ? t('settings.general.speechVoice.unavailable')
      : error === 'failed'
        ? t('settings.general.speechVoice.loadFailed')
        : selected?.label ?? catalog?.selectedVoice ?? ''

  async function choose(voiceId: string) {
    if (!catalog || saving) return
    const fromDraft = voiceId === draft.trim()
    if (voiceId === catalog.selectedVoice) {
      if (fromDraft) setDraft('')
      return
    }
    const stored = voiceId === catalog.defaultVoice ? '' : voiceId
    setSaving(true)
    try {
      await window.app.saveAppSettings({ speechVoices: { [catalog.credentialId]: stored } })
      const voices = catalog.voices.some((voice) => voice.id === voiceId)
        ? catalog.voices
        : [{ id: voiceId, label: voiceId }, ...catalog.voices]
      setCatalog({ ...catalog, voices, selectedVoice: voiceId })
      if (fromDraft) setDraft('')
    } catch (saveError) {
      toast.error(saveError instanceof Error && saveError.message
        ? saveError.message
        : t('settings.general.speechVoice.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  function submitVoiceId(event: FormEvent) {
    event.preventDefault()
    const voiceId = draft.trim()
    if (!voiceId) return
    void choose(voiceId)
  }

  function stopPreview() {
    previewSerial.current += 1
    previewAudio.current?.pause()
    previewAudio.current = null
    setPreviewPhase('idle')
  }

  function previewError(error: Extract<SpeechVoicePreviewResult, { ok: false }>['error']): string {
    switch (error) {
      case 'unconfigured': return t('settings.general.speechVoice.unavailable')
      case 'unavailable': return t('settings.general.speechVoice.previewUnavailable')
      case 'invalid': return t('settings.general.speechVoice.previewInvalid')
      case 'not-found': return t('settings.general.speechVoice.previewNotFound')
      case 'no-preview': return t('settings.general.speechVoice.previewMissing')
      default: return t('settings.general.speechVoice.previewFailed')
    }
  }

  async function previewVoice() {
    const voiceId = draft.trim() || catalog?.selectedVoice || ''
    if (!voiceId || previewPhase === 'loading') return
    stopPreview()
    const serial = previewSerial.current
    setPreviewPhase('loading')
    try {
      const result = await window.app.previewSpeechVoice(voiceId)
      if (serial !== previewSerial.current) return
      if (!result.ok) {
        toast.error(previewError(result.error))
        setPreviewPhase('idle')
        return
      }
      const audio = new Audio(`data:${result.mediaType};base64,${result.audioBase64}`)
      previewAudio.current = audio
      audio.onended = () => {
        if (serial === previewSerial.current) setPreviewPhase('idle')
      }
      await audio.play()
      if (serial !== previewSerial.current) {
        audio.pause()
        return
      }
      setPreviewPhase('playing')
    } catch (previewFailure) {
      if (serial !== previewSerial.current) return
      toast.error(previewFailure instanceof Error && previewFailure.message
        ? previewFailure.message
        : t('settings.general.speechVoice.previewFailed'))
      setPreviewPhase('idle')
    }
  }

  return (
    <SettingsRow
      label={t('settings.general.speechVoice.label')}
      description={t('settings.general.speechVoice.description')}
      footer={catalog && (catalog.fallback || catalog.customVoice) ? (
        <div className="space-y-2">
          {catalog.fallback && (
            <p className="text-xs text-muted-foreground">{t('settings.general.speechVoice.fallback')}</p>
          )}
          {catalog.customVoice && (
            <form className="flex flex-wrap items-center gap-2" onSubmit={submitVoiceId}>
              <Input
                aria-label={t('settings.general.speechVoice.voiceId')}
                placeholder={t('settings.general.speechVoice.voiceIdPlaceholder')}
                value={draft}
                disabled={saving}
                onChange={(event) => setDraft(event.target.value)}
                className="h-7 max-w-sm bg-background font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7"
                disabled={saving || !(draft.trim() || catalog.selectedVoice)}
                onClick={() => { previewPhase === 'idle' ? void previewVoice() : stopPreview() }}
              >
                {previewPhase === 'idle'
                  ? t('settings.general.speechVoice.preview')
                  : t('settings.general.speechVoice.previewStop')}
              </Button>
              <Button type="submit" size="sm" className="h-7" disabled={saving || !draft.trim()}>
                {t('settings.general.speechVoice.useVoiceId')}
              </Button>
            </form>
          )}
        </div>
      ) : undefined}
    >
      {error === 'failed' && !loading && (
        <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setAttempt((value) => value + 1)}>
          {t('settings.general.speechVoice.retry')}
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={loading || saving || !catalog}
            className={cn(settingsSelectTriggerClassName, 'max-w-56 shrink-0')}
          >
            <span className="truncate">{status}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        {catalog && (
          <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
            {catalog.voices.map((voice) => (
              <DropdownMenuItem
                key={voice.id}
                onClick={() => { void choose(voice.id) }}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate">{voice.label}</span>
                {catalog.selectedVoice === voice.id && <Check className="size-4 shrink-0 text-muted-foreground" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        )}
      </DropdownMenu>
    </SettingsRow>
  )
}
