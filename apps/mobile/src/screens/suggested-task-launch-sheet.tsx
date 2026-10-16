import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { ClipboardCheck } from 'lucide-react-native'
import type { SuggestedTaskLaunchChoice, SuggestedTaskLaunchOptions } from '@superone/shared/suggested-task'
import type { SuggestedTaskLaunchRequest } from '../suggested-task-actions'
import { AgentConfigFields } from '../prompts/AgentConfigFields'
import { SelectField } from '../prompts/EditableField'
import { PromptActions } from '../prompts/PromptControls'
import { PromptSheet } from '../prompts/PromptSheet'
import { Text } from '../ui/text'
import { useMobileLocale } from '../i18n/context'
import { useMobileTheme } from '../theme/context'

export interface SuggestedTaskLaunchSheetProps {
  request: SuggestedTaskLaunchRequest
  onDismiss(): void
}

/** The same host profiles and initial choice as the desktop card, in native controls. */
export function SuggestedTaskLaunchSheet({ request, onDismiss }: SuggestedTaskLaunchSheetProps) {
  const { t } = useMobileLocale()
  const { tokens: { colors, spacing } } = useMobileTheme()
  const [options, setOptions] = useState<SuggestedTaskLaunchOptions | null>(null)
  const [choice, setChoice] = useState<SuggestedTaskLaunchChoice | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const launching = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    let active = true
    alive.current = true
    setLoading(true); setError(''); setOptions(null); setChoice(null)
    Promise.resolve().then(() => request.loadOptions()).then(value => {
      if (active) { setOptions(value); setChoice(value.initial) }
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : t('Could not load agent options')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; alive.current = false }
  }, [request, retry])
  const profile = options?.profiles.find(item => item.id === choice?.agentId)
  const dismiss = () => { if (!launching.current) onDismiss() }
  const launch = async () => {
    if (!choice || !profile || launching.current) return
    launching.current = true
    setBusy(true); setError('')
    try {
      await request.launch(choice)
      if (alive.current) onDismiss()
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : t('Could not launch task'))
    } finally {
      launching.current = false
      if (alive.current) setBusy(false)
    }
  }
  return <PromptSheet title="Launch Task" icon={ClipboardCheck} onDismiss={dismiss}
    footer={<PromptActions tone="submit" approveLabel={busy ? 'Starting session…' : 'Launch'} rejectLabel="Cancel"
      disabled={loading || busy || !profile} rejectDisabled={busy} onApprove={() => void launch()} onReject={dismiss} />}>
    {loading ? <ActivityIndicator accessibilityLabel={t('Loading agents…')} color={colors.mutedForeground} /> : null}
    {error ? <View style={{ gap: spacing.sm }}>
      <Text accessibilityRole="alert" style={{ color: colors.destructive, fontSize: 13 }}>{t(error)}</Text>
      {!options ? <Pressable accessibilityRole="button" accessibilityLabel={t('Retry')} onPress={() => setRetry(value => value + 1)} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: colors.primary }}>{t('Retry')}</Text>
      </Pressable> : null}
    </View> : null}
    {!loading && options && !options.profiles.length ? <Text>{t('No agents available')}</Text> : null}
    {options && choice && profile ? <View pointerEvents={busy ? 'none' : 'auto'} style={{ gap: spacing.md, opacity: busy ? 0.6 : 1 }}>
      <SelectField label="Agent" value={choice.agentId} options={options.profiles.map(item => ({ id: item.id, label: item.name }))}
        onChange={agentId => setChoice({ agentId, settings: agentId === options.initial.agentId ? options.initial.settings : {} })} />
      <AgentConfigFields key={profile.id} harness={profile.harnessId} profile={profile}
        config={{ ...profile.defaultConfig, ...choice.settings }}
        onChange={settings => setChoice(current => current ? { ...current, settings: { ...current.settings, ...settings } } : current)} />
    </View> : null}
  </PromptSheet>
}
