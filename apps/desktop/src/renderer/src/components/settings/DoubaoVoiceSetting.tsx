import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'
import { DOUBAO_DEFAULT_SPEAKER, DOUBAO_O2_SPEAKERS, type DoubaoO2Speaker } from '@superone/shared/doubao-realtime'
import type { DesktopVoicePreference, DoubaoVoiceSettings } from '@superone/shared/doubao-call'
import { Button } from '@superone/ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@superone/ui/components/ui/dropdown-menu'
import { Input } from '@superone/ui/components/ui/input'
import { applyDoubaoVoiceSettings } from '@/stores/doubao-voice-preference'
import { SettingsRow } from './SettingsSection'
import { SettingsSegmentedControl } from './SettingsSegmentedControl'
import { settingsSelectTriggerClassName } from './select-trigger-class'

const SPEAKER_LABEL = {
  zh_female_vv_jupiter_bigtts: 'settings.general.doubaoVoice.speakers.vv',
  zh_female_xiaohe_jupiter_bigtts: 'settings.general.doubaoVoice.speakers.xiaohe',
  zh_male_yunzhou_jupiter_bigtts: 'settings.general.doubaoVoice.speakers.yunzhou',
  zh_male_xiaotian_jupiter_bigtts: 'settings.general.doubaoVoice.speakers.xiaotian',
  en_male_tim_uranus_bigtts: 'settings.general.doubaoVoice.speakers.tim',
  en_female_dacey_uranus_bigtts: 'settings.general.doubaoVoice.speakers.dacey',
  en_female_stokie_uranus_bigtts: 'settings.general.doubaoVoice.speakers.stokie',
} as const satisfies Record<DoubaoO2Speaker, string>

const EMPTY: DoubaoVoiceSettings = {
  preference: 'auto',
  speaker: DOUBAO_DEFAULT_SPEAKER,
  key: { configured: false, masked: '' },
}

/**
 * Desktop voice frontend, Doubao speaker, and speech key.
 * The key never returns to the renderer; only a masked status does.
 */
export function DoubaoVoiceSetting() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<DoubaoVoiceSettings>(EMPTY)
  const [keyEditing, setKeyEditing] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const read = window.app?.getDoubaoVoiceSettings
    if (!read) {
      setLoading(false)
      return
    }
    void read().then((next) => {
      if (!mounted) return
      setSettings(next)
      applyDoubaoVoiceSettings(next)
      setLoading(false)
    }).catch((err: unknown) => {
      if (!mounted) return
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    })
    return () => { mounted = false }
  }, [])

  async function save(patch: { preference?: DesktopVoicePreference; speaker?: string; apiKey?: string }) {
    setSaving(true)
    setError(null)
    try {
      const next = await window.app.setDoubaoVoiceSettings(patch)
      setSettings(next)
      applyDoubaoVoiceSettings(next)
      if (patch.apiKey !== undefined) {
        setKeyDraft('')
        setKeyEditing(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const speaker = (DOUBAO_O2_SPEAKERS as readonly string[]).includes(settings.speaker)
    ? settings.speaker as DoubaoO2Speaker
    : DOUBAO_DEFAULT_SPEAKER
  const busy = loading || saving

  return (
    <>
      <SettingsRow
        label={t('settings.general.doubaoVoice.frontend.label')}
        description={t('settings.general.doubaoVoice.frontend.description')}
      >
        <SettingsSegmentedControl
          label={t('settings.general.doubaoVoice.frontend.label')}
          value={settings.preference}
          disabled={busy}
          onChange={(preference) => { void save({ preference }) }}
          options={[
            { value: 'auto', label: t('settings.general.doubaoVoice.frontendAuto') },
            { value: 'codex', label: t('settings.general.doubaoVoice.frontendCodex') },
            { value: 'doubao', label: t('settings.general.doubaoVoice.frontendDoubao') },
          ]}
        />
      </SettingsRow>
      <SettingsRow
        label={t('settings.general.doubaoVoice.speaker.label')}
        description={t('settings.general.doubaoVoice.speaker.description')}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" disabled={busy} className={`${settingsSelectTriggerClassName} max-w-full min-w-28 justify-between`}>
              <span className="truncate">{t(SPEAKER_LABEL[speaker])}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {DOUBAO_O2_SPEAKERS.map((id) => (
              <DropdownMenuItem key={id} onClick={() => { void save({ speaker: id }) }} className="flex items-center justify-between gap-2">
                <span className="truncate">{t(SPEAKER_LABEL[id])}</span>
                {speaker === id && <Check className="size-4 shrink-0 text-muted-foreground" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SettingsRow>
      <SettingsRow
        label={t('settings.general.doubaoVoice.apiKey.label')}
        description={t('settings.general.doubaoVoice.apiKey.description')}
        footer={(
          <>
            {keyEditing || !settings.key.configured ? (
              <form
                className="flex min-w-0 flex-wrap items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (keyDraft.trim()) void save({ apiKey: keyDraft })
                }}
              >
                <Input
                  type="password"
                  autoFocus={keyEditing}
                  aria-label={t('settings.general.doubaoVoice.apiKey.label')}
                  placeholder={t('settings.general.doubaoVoice.apiKey.placeholder')}
                  value={keyDraft}
                  onChange={(event) => setKeyDraft(event.target.value)}
                  disabled={busy}
                  className="h-7 min-w-0 max-w-sm flex-1 bg-background font-mono text-xs"
                />
                <Button type="submit" size="sm" className="h-7" disabled={busy || !keyDraft.trim()}>
                  {t('settings.general.doubaoVoice.apiKey.save')}
                </Button>
                {settings.key.configured && (
                  <Button type="button" variant="ghost" size="sm" className="h-7" disabled={busy} onClick={() => { setKeyEditing(false); setKeyDraft(''); setError(null) }}>
                    {t('settings.general.doubaoVoice.apiKey.cancel')}
                  </Button>
                )}
              </form>
            ) : (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="min-w-0 break-all font-mono text-xs">{settings.key.masked}</p>
                <Button variant="outline" size="sm" className="h-7" disabled={busy} onClick={() => setKeyEditing(true)}>
                  {t('settings.general.doubaoVoice.apiKey.change')}
                </Button>
                <Button variant="ghost" size="sm" className="h-7" disabled={busy} onClick={() => { void save({ apiKey: '' }) }}>
                  {t('settings.general.doubaoVoice.apiKey.clear')}
                </Button>
              </div>
            )}
            {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
          </>
        )}
      />
    </>
  )
}
