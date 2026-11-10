import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'
import { DOUBAO_DEFAULT_SPEAKER, DOUBAO_O2_SPEAKERS, type DoubaoO2Speaker } from '@superone/shared/doubao-realtime'
import type { DesktopVoicePreference, DesktopVoiceSettings } from '@superone/shared/desktop-voice-route'
import { GEMINI_DEFAULT_VOICE, GEMINI_LIVE_VOICES, isGeminiLiveVoice, type GeminiLiveVoice } from '@superone/shared/gemini-realtime'
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

const GEMINI_VOICE_TRAIT = {
  Zephyr: 'settings.general.doubaoVoice.geminiVoices.Zephyr',
  Puck: 'settings.general.doubaoVoice.geminiVoices.Puck',
  Charon: 'settings.general.doubaoVoice.geminiVoices.Charon',
  Kore: 'settings.general.doubaoVoice.geminiVoices.Kore',
  Fenrir: 'settings.general.doubaoVoice.geminiVoices.Fenrir',
  Leda: 'settings.general.doubaoVoice.geminiVoices.Leda',
  Orus: 'settings.general.doubaoVoice.geminiVoices.Orus',
  Aoede: 'settings.general.doubaoVoice.geminiVoices.Aoede',
  Callirrhoe: 'settings.general.doubaoVoice.geminiVoices.Callirrhoe',
  Autonoe: 'settings.general.doubaoVoice.geminiVoices.Autonoe',
  Enceladus: 'settings.general.doubaoVoice.geminiVoices.Enceladus',
  Iapetus: 'settings.general.doubaoVoice.geminiVoices.Iapetus',
  Umbriel: 'settings.general.doubaoVoice.geminiVoices.Umbriel',
  Algieba: 'settings.general.doubaoVoice.geminiVoices.Algieba',
  Despina: 'settings.general.doubaoVoice.geminiVoices.Despina',
  Erinome: 'settings.general.doubaoVoice.geminiVoices.Erinome',
  Algenib: 'settings.general.doubaoVoice.geminiVoices.Algenib',
  Rasalgethi: 'settings.general.doubaoVoice.geminiVoices.Rasalgethi',
  Laomedeia: 'settings.general.doubaoVoice.geminiVoices.Laomedeia',
  Achernar: 'settings.general.doubaoVoice.geminiVoices.Achernar',
  Alnilam: 'settings.general.doubaoVoice.geminiVoices.Alnilam',
  Schedar: 'settings.general.doubaoVoice.geminiVoices.Schedar',
  Gacrux: 'settings.general.doubaoVoice.geminiVoices.Gacrux',
  Pulcherrima: 'settings.general.doubaoVoice.geminiVoices.Pulcherrima',
  Achird: 'settings.general.doubaoVoice.geminiVoices.Achird',
  Zubenelgenubi: 'settings.general.doubaoVoice.geminiVoices.Zubenelgenubi',
  Vindemiatrix: 'settings.general.doubaoVoice.geminiVoices.Vindemiatrix',
  Sadachbia: 'settings.general.doubaoVoice.geminiVoices.Sadachbia',
  Sadaltager: 'settings.general.doubaoVoice.geminiVoices.Sadaltager',
  Sulafat: 'settings.general.doubaoVoice.geminiVoices.Sulafat',
} as const satisfies Record<GeminiLiveVoice, string>

const EMPTY: DesktopVoiceSettings = {
  preference: 'doubao',
  speaker: DOUBAO_DEFAULT_SPEAKER,
  geminiVoice: GEMINI_DEFAULT_VOICE,
  key: { configured: false, masked: '' },
  geminiKey: { configured: false, masked: '' },
}

function SpeechKeyFields({
  label,
  placeholder,
  status,
  editing,
  draft,
  busy,
  onDraft,
  onBeginEdit,
  onCancel,
  onSave,
  onClear,
}: {
  label: string
  placeholder: string
  status: { configured: boolean; masked: string }
  editing: boolean
  draft: string
  busy: boolean
  onDraft: (value: string) => void
  onBeginEdit: () => void
  onCancel: () => void
  onSave: () => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  if (editing || !status.configured) {
    return (
      <form
        className="flex min-w-0 flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (draft.trim()) onSave()
        }}
      >
        <Input
          type="password"
          autoFocus={editing}
          aria-label={label}
          placeholder={placeholder}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          disabled={busy}
          className="h-7 min-w-0 max-w-sm flex-1 bg-background font-mono text-xs"
        />
        <Button type="submit" size="sm" className="h-7" disabled={busy || !draft.trim()}>
          {t('settings.general.doubaoVoice.apiKey.save')}
        </Button>
        {status.configured && (
          <Button type="button" variant="ghost" size="sm" className="h-7" disabled={busy} onClick={onCancel}>
            {t('settings.general.doubaoVoice.apiKey.cancel')}
          </Button>
        )}
      </form>
    )
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <p className="min-w-0 break-all font-mono text-xs">{status.masked}</p>
      <Button variant="outline" size="sm" className="h-7" disabled={busy} onClick={onBeginEdit}>
        {t('settings.general.doubaoVoice.apiKey.change')}
      </Button>
      <Button variant="ghost" size="sm" className="h-7" disabled={busy} onClick={onClear}>
        {t('settings.general.doubaoVoice.apiKey.clear')}
      </Button>
    </div>
  )
}

/**
 * Voice model for sessions that are not official Codex.
 * Codex Realtime is fixed by the session. The selected model shows only its key and voice.
 */
export function DoubaoVoiceSetting() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<DesktopVoiceSettings>(EMPTY)
  const [keyEditing, setKeyEditing] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [geminiEditing, setGeminiEditing] = useState(false)
  const [geminiDraft, setGeminiDraft] = useState('')
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

  async function save(patch: {
    preference?: DesktopVoicePreference
    speaker?: string
    geminiVoice?: string
    apiKey?: string
    geminiApiKey?: string
  }) {
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
      if (patch.geminiApiKey !== undefined) {
        setGeminiDraft('')
        setGeminiEditing(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const model: DesktopVoicePreference = settings.preference === 'gemini' ? 'gemini' : 'doubao'
  const speaker = (DOUBAO_O2_SPEAKERS as readonly string[]).includes(settings.speaker)
    ? settings.speaker as DoubaoO2Speaker
    : DOUBAO_DEFAULT_SPEAKER
  const geminiVoice = isGeminiLiveVoice(settings.geminiVoice) ? settings.geminiVoice : GEMINI_DEFAULT_VOICE
  const busy = loading || saving
  const voiceLabel = (id: GeminiLiveVoice) => `${id} · ${t(GEMINI_VOICE_TRAIT[id])}`
  const errorText = error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null

  return (
    <>
      <SettingsRow
        label={t('settings.general.doubaoVoice.frontend.label')}
        description={t('settings.general.doubaoVoice.frontend.description')}
      >
        <SettingsSegmentedControl
          label={t('settings.general.doubaoVoice.frontend.label')}
          value={model}
          disabled={busy}
          onChange={(preference) => { void save({ preference }) }}
          options={[
            { value: 'doubao', label: t('settings.general.doubaoVoice.frontendDoubao') },
            { value: 'gemini', label: t('settings.general.doubaoVoice.frontendGemini') },
          ]}
        />
      </SettingsRow>
      {model === 'gemini' ? (
        <>
          <SettingsRow
            label={t('settings.general.doubaoVoice.geminiSpeaker.label')}
            description={t('settings.general.doubaoVoice.geminiSpeaker.description')}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" disabled={busy} className={`${settingsSelectTriggerClassName} max-w-full min-w-28 justify-between`}>
                  <span className="truncate">{voiceLabel(geminiVoice)}</span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {GEMINI_LIVE_VOICES.map((id) => (
                  <DropdownMenuItem key={id} onClick={() => { void save({ geminiVoice: id }) }} className="flex items-center justify-between gap-2">
                    <span className="truncate">{voiceLabel(id)}</span>
                    {geminiVoice === id && <Check className="size-4 shrink-0 text-muted-foreground" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </SettingsRow>
          <SettingsRow
            label={t('settings.general.doubaoVoice.geminiApiKey.label')}
            description={t('settings.general.doubaoVoice.geminiApiKey.description')}
            footer={(
              <>
                <SpeechKeyFields
                  label={t('settings.general.doubaoVoice.geminiApiKey.label')}
                  placeholder={t('settings.general.doubaoVoice.geminiApiKey.placeholder')}
                  status={settings.geminiKey}
                  editing={geminiEditing}
                  draft={geminiDraft}
                  busy={busy}
                  onDraft={setGeminiDraft}
                  onBeginEdit={() => setGeminiEditing(true)}
                  onCancel={() => { setGeminiEditing(false); setGeminiDraft(''); setError(null) }}
                  onSave={() => { void save({ geminiApiKey: geminiDraft }) }}
                  onClear={() => { void save({ geminiApiKey: '' }) }}
                />
                {errorText}
              </>
            )}
          />
        </>
      ) : (
        <>
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
                <SpeechKeyFields
                  label={t('settings.general.doubaoVoice.apiKey.label')}
                  placeholder={t('settings.general.doubaoVoice.apiKey.placeholder')}
                  status={settings.key}
                  editing={keyEditing}
                  draft={keyDraft}
                  busy={busy}
                  onDraft={setKeyDraft}
                  onBeginEdit={() => setKeyEditing(true)}
                  onCancel={() => { setKeyEditing(false); setKeyDraft(''); setError(null) }}
                  onSave={() => { void save({ apiKey: keyDraft }) }}
                  onClear={() => { void save({ apiKey: '' }) }}
                />
                {errorText}
              </>
            )}
          />
        </>
      )}
    </>
  )
}
