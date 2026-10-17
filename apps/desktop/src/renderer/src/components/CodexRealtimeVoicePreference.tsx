import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, LoaderCircle, Play, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@superone/ui/components/ui/popover'
import { cn } from '@superone/ui/lib/utils'
import type { CodexRealtimeVoiceCatalog } from '@superone/shared/agent-types'
import { SettingsRow } from '@/components/settings/SettingsSection'
import { settingsSelectTriggerClassName } from '@/components/settings/select-trigger-class'
import { useCodexVoicePreviews } from './useCodexVoicePreviews'

interface CodexRealtimeVoicePreferenceProps {
  projectPath: string | null
  value: string
  disabled?: boolean
  onChange: (voice: string) => Promise<void>
}

function formatVoiceName(voice: string): string {
  return voice ? `${voice[0].toUpperCase()}${voice.slice(1)}` : voice
}

const ACCENT_LABELS = {
  'American English': 'settings.preferences.realtimeVoice.groups.americanEnglish',
  'British English': 'settings.preferences.realtimeVoice.groups.britishEnglish',
  'Brazilian Portuguese': 'settings.preferences.realtimeVoice.groups.brazilianPortuguese',
  French: 'settings.preferences.realtimeVoice.groups.french',
  German: 'settings.preferences.realtimeVoice.groups.german',
  Hindi: 'settings.preferences.realtimeVoice.groups.hindi',
  Japanese: 'settings.preferences.realtimeVoice.groups.japanese',
  Korean: 'settings.preferences.realtimeVoice.groups.korean',
  'Mexican Spanish': 'settings.preferences.realtimeVoice.groups.mexicanSpanish',
} as const

export function CodexRealtimeVoicePreference({
  projectPath,
  value,
  disabled = false,
  onChange,
}: CodexRealtimeVoicePreferenceProps) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<CodexRealtimeVoiceCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const selectedVoiceButton = useRef<HTMLButtonElement>(null)
  const language = i18n.resolvedLanguage?.startsWith('zh') ? 'zh' : 'en'
  const preview = useCodexVoicePreviews(open, disabled, language, projectPath)
  const { stop: stopPreview } = preview

  useEffect(() => { stopPreview() }, [value, stopPreview])
  useEffect(() => { setOpen(false) }, [language, projectPath])

  useEffect(() => {
    let mounted = true
    setLoading(true)
    setLoadError(false)
    window.app.codexListRealtimeVoices(projectPath)
      .then((nextCatalog) => {
        if (mounted) setCatalog(nextCatalog)
      })
      .catch(() => {
        if (!mounted) return
        setCatalog(null)
        setLoadError(true)
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => { mounted = false }
  }, [projectPath])

  const options = useMemo(() => catalog?.voices ?? [], [catalog])
  const grouped = options.some((voice) => preview.voices[voice]?.accent)
  const groups = useMemo(() => {
    const result = new Map<string, string[]>()
    for (const voice of options) {
      const accent = preview.voices[voice]?.accent ?? ''
      const entries = result.get(accent) ?? []
      entries.push(voice)
      result.set(accent, entries)
    }
    return [...result].sort(([a], [b]) => a === b ? 0 : a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'en'))
  }, [options, preview.voices])
  const selectedVoice = options.includes(value)
    ? value
    : options.includes(catalog?.defaultVoice ?? '')
      ? catalog?.defaultVoice ?? ''
      : options[0] ?? ''

  const selectVoice = useCallback(async (voice: string) => {
    stopPreview()
    if (voice === selectedVoice) {
      setOpen(false)
      return
    }
    try {
      await onChange(voice)
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [onChange, selectedVoice, stopPreview])

  return (
    <SettingsRow
      label={t('settings.preferences.realtimeVoice.label')}
      description={t('settings.preferences.realtimeVoice.description')}
    >
      <Popover open={open && preview.ready} onOpenChange={(nextOpen) => { if (!nextOpen) stopPreview(); setOpen(nextOpen) }}>
        <PopoverTrigger asChild>
          <button
            disabled={disabled || loading || loadError || !preview.ready}
            className={settingsSelectTriggerClassName}
          >
            <span className="max-w-[180px] truncate">
              {loadError
                ? t('settings.preferences.realtimeVoice.loadFailed')
                : loading || !preview.ready
                  ? t('settings.preferences.realtimeVoice.loading')
                  : formatVoiceName(selectedVoice)}
            </span>
            <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="bottom"
          className="w-72 p-2"
          onOpenAutoFocus={(event) => {
            if (!selectedVoiceButton.current) return
            event.preventDefault()
            selectedVoiceButton.current.focus({ preventScroll: true })
          }}
        >
          <PopoverHeader className="px-2 pb-2">
            <PopoverTitle>{t('settings.preferences.realtimeVoice.menuTitle')}</PopoverTitle>
          </PopoverHeader>
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {groups.map(([accent, voices]) => {
              const key = Object.hasOwn(ACCENT_LABELS, accent) ? ACCENT_LABELS[accent as keyof typeof ACCENT_LABELS] : null
              const label = key ? t(key) : accent || t('settings.preferences.realtimeVoice.groups.other')
              return <section key={accent} role="group" aria-label={grouped ? label : undefined} className="space-y-1">
                {grouped && <h3 className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">{label}</h3>}
                {voices.map((voice) => {
                  const active = selectedVoice === voice
                  const playing = preview.playing === voice
                  const name = formatVoiceName(voice)
                  const previewLabel = t(playing ? 'settings.preferences.realtimeVoice.stopPreview' : 'settings.preferences.realtimeVoice.preview', { voice: name })
                  return (
                    <div key={voice} className={cn('flex items-center gap-1 rounded-md pl-1 transition-colors', !disabled && 'hover:bg-accent hover:text-accent-foreground has-focus-visible:bg-accent has-focus-visible:text-accent-foreground', active && 'bg-secondary')}>
                      <IconButton
                        size="md"
                        variant="nested"
                        className="focus-visible:ring-0"
                        aria-label={previewLabel}
                        aria-pressed={playing}
                        tooltip={!preview.loading && !preview.voices[voice]?.previewUrl ? t('settings.preferences.realtimeVoice.previewUnavailable') : previewLabel}
                        disabled={disabled || preview.loading || !preview.voices[voice]?.previewUrl}
                        onClick={() => preview.toggle(voice)}
                      >
                        {playing && preview.buffering ? <LoaderCircle className="animate-spin" /> : playing ? <Square /> : <Play />}
                      </IconButton>
                      <Button
                        ref={active ? selectedVoiceButton : undefined}
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="min-w-0 flex-1 justify-start px-2.5 hover:bg-transparent dark:hover:bg-transparent focus-visible:ring-0"
                        disabled={disabled}
                        onClick={() => { void selectVoice(voice) }}
                      >
                        <span className="truncate">{name}</span>
                        {active && <Check className="ml-auto text-primary" data-icon="inline-end" />}
                      </Button>
                    </div>
                  )
                })}
              </section>
            })}
          </div>
          {preview.loading && <p role="status" className="px-2 pt-2 text-xs text-muted-foreground">{t('settings.preferences.realtimeVoice.previewLoading')}</p>}
          {!preview.loading && !preview.loadError && !Object.values(preview.voices).some((voice) => voice.previewUrl) && <p className="px-2 pt-2 text-xs text-muted-foreground">{t('settings.preferences.realtimeVoice.previewUnavailable')}</p>}
          {preview.loadError && <div role="alert" className="flex items-center gap-2 px-2 pt-2">
            <p className="flex-1 text-xs text-muted-foreground">{t('settings.preferences.realtimeVoice.previewLoadFailed')}</p>
            <Button size="sm" variant="ghost" onClick={preview.reload}>{t('settings.preferences.realtimeVoice.previewRetry')}</Button>
          </div>}
          {preview.playError && <p role="alert" className="px-2 pt-2 text-xs text-destructive">{t('settings.preferences.realtimeVoice.previewFailed')}</p>}
        </PopoverContent>
      </Popover>
    </SettingsRow>
  )
}
