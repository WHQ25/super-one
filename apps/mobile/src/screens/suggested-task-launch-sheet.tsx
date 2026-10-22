import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { ClipboardCheck } from 'lucide-react-native'
import type { SessionAgentLaunchSettings, SessionAgentProfile } from '@superone/shared/agent-types'
import { sandboxInfoFromMode } from '@superone/shared/harness/harness-sandbox'
import { HARNESS_LAUNCH_OPTIONS } from '@superone/shared/launch-options'
import type { SuggestedTaskLaunchChoice, SuggestedTaskLaunchOptions } from '@superone/shared/suggested-task'
import type { SuggestedTaskLaunchRequest } from '../suggested-task-actions'
import { patchSuggestedTaskSettings, suggestedTaskLaunchView } from '../suggested-task-launch-state'
import { SelectField } from '../prompts/EditableField'
import { PromptActions } from '../prompts/PromptControls'
import { PromptSheet } from '../prompts/PromptSheet'
import { Text } from '../ui/text'
import { ModelPicker } from '../ui/model-picker'
import { PermissionModeSelector } from '../ui/permission-mode-selector'
import { SandboxSelector } from '../ui/sandbox-selector'
import { useMobileLocale } from '../i18n/context'
import { useMobileTheme } from '../theme/context'

export interface SuggestedTaskLaunchSheetProps {
  request: SuggestedTaskLaunchRequest
  onDismiss(): void
}

/**
 * Agent plus the desktop card's launch bar: model, per-model effort, Fast,
 * provider, permission and sandbox. Edits stay on the choice until Launch.
 */
function LaunchRuntimeRow({ profile, settings, disabled, onChange }: {
  profile: SessionAgentProfile
  settings: SessionAgentLaunchSettings
  disabled: boolean
  onChange: (settings: SessionAgentLaunchSettings) => void
}) {
  const { tokens: { colors, spacing } } = useMobileTheme()
  const displayed = { ...profile.defaultConfig, ...settings }
  const view = suggestedTaskLaunchView(profile, displayed)
  const patch = (next: Partial<SessionAgentLaunchSettings>) => onChange(patchSuggestedTaskSettings(profile, settings, displayed, next))
  const permissionMode = displayed.permissionMode ?? HARNESS_LAUNCH_OPTIONS[profile.harnessId].defaultPermissionMode
  return <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs,
    paddingVertical: 2, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}>
    <ModelPicker compact harness={profile.harnessId} disabled={disabled}
      models={view.models} model={view.model} onModel={(model) => patch({ model })}
      efforts={view.efforts} effort={view.effort} onEffort={(effort) => patch({ effort })}
      optionParams={view.optionParams}
      onOptionParam={(id, value) => {
        if (id === 'claudeFastMode') patch({ claudeFastMode: value === 'true' })
        if (id === 'fast') patch({ fastMode: value === 'true' })
      }}
      providers={view.providers} providerId={view.providerId}
      onProvider={view.providers.length ? (apiProviderId) => patch({ apiProviderId }) : undefined}
      acpAgentId={profile.acpAgentId} />
    <PermissionModeSelector harness={profile.harnessId} disabled={disabled}
      modes={HARNESS_LAUNCH_OPTIONS[profile.harnessId].permissionModes}
      value={permissionMode} onChange={(mode) => patch({ permissionMode: mode as SessionAgentLaunchSettings['permissionMode'] })} />
    <SandboxSelector harness={profile.harnessId} disabled={disabled}
      sandboxInfo={sandboxInfoFromMode(displayed.sandboxMode ?? 'off')}
      permissionMode={permissionMode} onChange={(sandboxMode) => patch({ sandboxMode })} />
  </View>
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
      <LaunchRuntimeRow key={profile.id} profile={profile} settings={choice.settings} disabled={busy}
        onChange={settings => setChoice(current => current ? { ...current, settings } : current)} />
    </View> : null}
  </PromptSheet>
}
