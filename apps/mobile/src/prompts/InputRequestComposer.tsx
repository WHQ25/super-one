import { useCallback, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, View, useWindowDimensions } from 'react-native'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { isInputRequest } from '@superone/shared/input-request-presentation'
import type { SchemaFormResource, SchemaFormValue } from '@superone/shared/schema-form'
import type { InputRequestDraft } from '../input-request-state'
import { Text } from '../ui/text'
import { useMobileLocale } from '../i18n/context'
import { useMobileTheme } from '../theme/context'
import { PromptActions } from './PromptControls'
import { SchemaFormFields } from './SchemaFormFields'
import { useSchemaFormState, type SchemaFormDraft } from './use-schema-form-state'
import { usePromptStyles } from './styles'

export interface InputRequestComposerProps {
  request: PermissionRequest
  connected: boolean
  error?: string
  draft?: InputRequestDraft
  onDraftChange?: (draft: InputRequestDraft) => void
  onPickFiles?: (field: string) => Promise<SchemaFormResource[]>
  onSubmit: (values: Record<string, SchemaFormValue>) => Promise<void>
  onCancel: () => Promise<void>
}

/** Native composer-slot form. It never mounts a permission sheet or replaces the chat draft. */
export function InputRequestComposer(props: InputRequestComposerProps) {
  const styles = usePromptStyles()
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const { height } = useWindowDimensions()
  const [resources, setResources] = useState(() => props.draft?.resources ?? new Map<string, SchemaFormResource[]>())
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const pickingRef = useRef(false)
  const fields = useMemo(() => props.request.schemaForm?.supported ? props.request.schemaForm.fields.map(field => field.kind === 'resource'
    ? { ...field, options: [...field.options, ...(resources.get(field.name) ?? []).filter(resource => !field.options.some(option => option.uri === resource.uri))] }
    : field) : [], [props.request.schemaForm, resources])
  const onDraftChange = useCallback((draft: SchemaFormDraft) => { props.onDraftChange?.({ ...draft, resources }) }, [props.onDraftChange, resources])
  const form = useSchemaFormState(fields, props.request.requestId, props.draft, onDraftChange)
  const run = async (action: () => Promise<void>) => {
    if (inFlight.current || pickingRef.current || !props.connected) return
    inFlight.current = true; setBusy(true); setError(null)
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : t('Could not submit. Please try again.')) }
    finally { inFlight.current = false; setBusy(false) }
  }
  const pick = async (field: string) => {
    if (inFlight.current || pickingRef.current || !props.connected || !props.onPickFiles) return []
    pickingRef.current = true; setPicking(true); setError(null)
    try {
      const chosen = await props.onPickFiles(field)
      setResources(current => new Map(current).set(field, [...(current.get(field) ?? []), ...chosen.filter(resource => !(current.get(field) ?? []).some(option => option.uri === resource.uri))]))
      return chosen
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('Could not upload. Please try again.')); return [] }
    finally { pickingRef.current = false; setPicking(false) }
  }
  if (!isInputRequest(props.request)) return null
  const meta = props.request.inputRequest
  const unsupported = !props.request.schemaForm?.supported
    || fields.some(field => field.kind === 'resource' && field.userOptions?.kind === 'directory')
  const disabled = busy || picking || !props.connected
  return <View testID="input-request-composer" style={[styles.stack, { padding: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background }]}>
    <View style={styles.tight}>
      <Text style={styles.meta}>{meta.origin.kind === 'miniapp' ? meta.origin.appName ?? meta.origin.appId : t(meta.origin.kind === 'agent' ? 'Agent' : 'Widget')}</Text>
      <Text style={styles.title}>{meta.title}</Text>
      {meta.description ? <Text style={styles.meta}>{meta.description}</Text> : null}
    </View>
    {unsupported ? <Text accessibilityRole="alert" style={styles.meta}>{t('This form cannot be completed on this phone.')}</Text>
      : <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" style={{ maxHeight: Math.min(320, height * 0.36) }} contentContainerStyle={styles.tight}>
        {form.steps.length > 1 ? <Text accessibilityLabel={t('Step {current} of {total}').replace('{current}', String(form.stepIndex + 1)).replace('{total}', String(form.steps.length))} style={styles.meta}>{form.stepIndex + 1}/{form.steps.length}</Text> : null}
        <View key={form.stepIndex} pointerEvents={disabled ? 'none' : 'auto'}>
          <SchemaFormFields fields={form.step} values={form.values} errors={form.shownErrors} onChange={form.setField}
            onPickFiles={props.onPickFiles ? pick : undefined} picking={picking} disabled={disabled} />
        </View>
      </ScrollView>}
    {!props.connected ? <Text style={styles.meta}>{t('Reconnect to submit this form.')}</Text> : null}
    {error || props.error ? <Text accessibilityRole="alert" style={[styles.meta, { color: colors.destructive }]}>{error || props.error}</Text> : null}
    {busy || picking ? <View style={styles.row}><ActivityIndicator size="small" color={colors.mutedForeground} /><Text style={styles.meta}>{t(picking ? 'Uploading…' : 'Submitting…')}</Text></View> : null}
    {unsupported ? <Pressable accessibilityRole="button" accessibilityLabel={t('Cancel')} disabled={disabled} onPress={() => { void run(props.onCancel) }} style={[styles.action, { borderWidth: 1, borderColor: colors.border }]}><Text style={styles.actionText}>{t('Cancel')}</Text></Pressable>
      : <PromptActions tone="submit" approveLabel={form.lastStep ? meta.submitLabel ?? 'Submit' : 'Next'} rejectLabel="Cancel"
        disabled={disabled} rejectDisabled={disabled}
        onApprove={() => { if (!disabled) form.next(values => { void run(() => props.onSubmit(values)) }) }}
        onBack={form.stepIndex > 0 && !disabled ? () => form.setStepIndex(form.stepIndex - 1) : undefined}
        onReject={() => { void run(props.onCancel) }} />}
  </View>
}
