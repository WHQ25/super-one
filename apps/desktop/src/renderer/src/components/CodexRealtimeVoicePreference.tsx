import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@superone/ui/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@superone/ui/components/ui/popover'
import { cn } from '@superone/ui/lib/utils'
import type { CodexRealtimeVoiceCatalog } from '@superone/shared/agent-types'
import { SettingsRow } from '@/components/settings/SettingsSection'
import { settingsSelectTriggerClassName } from '@/components/settings/select-trigger-class'

interface CodexRealtimeVoicePreferenceProps {
  projectPath: string | null
  value: string
  disabled?: boolean
  onChange: (voice: string) => Promise<void>
}

function formatVoiceName(voice: string): string {
  return voice ? `${voice[0].toUpperCase()}${voice.slice(1)}` : voice
}

export function CodexRealtimeVoicePreference({
  projectPath,
  value,
  disabled = false,
  onChange,
}: CodexRealtimeVoicePreferenceProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<CodexRealtimeVoiceCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

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
  const selectedVoice = options.includes(value)
    ? value
    : options.includes(catalog?.defaultVoice ?? '')
      ? catalog?.defaultVoice ?? ''
      : options[0] ?? ''

  const selectVoice = useCallback(async (voice: string) => {
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
  }, [onChange, selectedVoice])

  return (
    <SettingsRow
      label={t('settings.preferences.realtimeVoice.label')}
      description={t('settings.preferences.realtimeVoice.description')}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            disabled={disabled || loading || loadError}
            className={settingsSelectTriggerClassName}
          >
            <span className="max-w-[180px] truncate">
              {loading
                ? t('settings.preferences.realtimeVoice.loading')
                : loadError
                  ? t('settings.preferences.realtimeVoice.loadFailed')
                  : formatVoiceName(selectedVoice)}
            </span>
            <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" side="bottom" className="w-72 p-2">
          <PopoverHeader className="px-2 pb-2">
            <PopoverTitle>{t('settings.preferences.realtimeVoice.menuTitle')}</PopoverTitle>
            <PopoverDescription>{t('settings.preferences.realtimeVoice.menuDescription')}</PopoverDescription>
          </PopoverHeader>
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {options.map((voice) => {
              const active = selectedVoice === voice
              return (
                <Button
                  key={voice}
                  type="button"
                  size="sm"
                  variant={active ? 'secondary' : 'ghost'}
                  className="w-full justify-start"
                  disabled={disabled}
                  onClick={() => { void selectVoice(voice) }}
                >
                  <span className="truncate">{formatVoiceName(voice)}</span>
                  {active && <Check data-icon="inline-end" />}
                </Button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </SettingsRow>
  )
}
