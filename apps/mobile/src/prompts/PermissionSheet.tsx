import { useEffect, useMemo, useState } from 'react'
import { Linking, View } from 'react-native'
import { Text } from '../ui/text'
import type { HarnessId, RemoteSystemInfo, PermissionRequest } from '@superone/shared/agent-types'
import { canRememberPermission } from '@superone/shared/permission-presentation'
import { schemaFormContent } from '@superone/shared/schema-form'
import { permissionSchemaForm, permissionSheetPresentation, permissionSuggestionLabel } from '../permission-sheet-state'
import { permissionPromptTitle } from '../pending-prompt-state'
import { permissionPromptIcon } from './prompt-icon'
import { elicitationServer, PromptGlyph } from './PromptGlyph'
import { PromptSheet } from './PromptSheet'
import { PromptActions, PromptChoice, PromptPill } from './PromptControls'
import { PermissionContent } from './PermissionContent'
import { PermissionEditors } from './PermissionEditors'
import { editablePermission, editedPermissionAnswers, permissionEditsValid } from './permission-edit-state'
import { showRememberPermission } from './prompt-content'
import { monospace, usePromptStyles } from './styles'
import { SchemaFormFields } from './SchemaFormFields'
import { useSchemaFormState } from './use-schema-form-state'
import { useMobileLocale } from '../i18n/context'
import { useMobileTheme } from '../theme/context'

export function PermissionSheet(props: {
  perm: PermissionRequest | null
  loadSystemInfo?: (harness: HarnessId) => Promise<RemoteSystemInfo>
  onAllow: (id: string, formAnswers?: Record<string, unknown>, alwaysAllow?: boolean, selectedSuggestions?: number[]) => void
  onDeny: (id: string, reason?: string) => void
  /** Put away behind a strip rather than denied; see `PromptSheet`. */
  collapsed?: boolean
  onCollapse?: (id: string) => void
}) {
  const styles = usePromptStyles()
  const { t } = useMobileLocale()
  const [draft, setDraft] = useState<PermissionRequest | null>(() => props.perm ? editablePermission(props.perm) : null)
  const [invalidFields, setInvalidFields] = useState<Record<string, boolean>>({})
  const perm = draft?.requestId === props.perm?.requestId ? draft : props.perm ? editablePermission(props.perm) : null
  useEffect(() => { setDraft(props.perm ? editablePermission(props.perm) : null); setInvalidFields({}) }, [props.perm])
  const schemaForm = perm?.schemaForm
  const legacyForm = perm?.elicitationForm
  const form = useMemo(() => permissionSchemaForm({ schemaForm, elicitationForm: legacyForm }), [schemaForm, legacyForm])
  const fields = useMemo(() => (form?.supported ? form.fields : []), [form])
  const { stepIndex, setStepIndex, step, lastStep, values, errors: stepErrors, shownErrors, setField, steps } = useSchemaFormState(fields, perm?.requestId ?? '')
  const [feedback, setFeedback] = useState('')
  // Which remember choice is on: the prompt's "always" (project / persistent) or, for a
  // terminal command, the session-only lifetime. One at a time, like the desktop rows.
  const [remember, setRemember] = useState<'always' | 'session' | null>(null)
  const [rememberRequestId, setRememberRequestId] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Set<number>>(new Set())
  useEffect(() => {
    setFeedback(''); setRemember(null); setSuggestions(new Set())
  }, [fields, perm?.requestId])
  // Earlier steps were valid to move on, and only this step's fields can change.
  if (!perm) return null
  const unsupportedForm = form && !form.supported ? form : null
  const presentation = permissionSheetPresentation(perm)
  const allowRemember = Boolean(presentation.alwaysLabel && showRememberPermission(perm))
  const isScoped = !!perm.permissionDetails && !perm.requestKind
  const rememberingScoped = isScoped && rememberRequestId === perm.requestId && remember === 'always' && canRememberPermission(perm)
  const icon = <PromptGlyph icon={permissionPromptIcon(perm)} server={elicitationServer(perm)} />
  const title = rememberingScoped ? t('Remember Permission in This Project?') : permissionPromptTitle(perm, t)
  const deny = () => {
    if (rememberingScoped) { setRemember(null); setRememberRequestId(null); return }
    props.onDeny(perm.requestId, feedback.trim() || undefined)
  }
  const toggleRemember = (choice: 'always' | 'session') => {
    setRememberRequestId(perm.requestId)
    setRemember((current) => (current === choice ? null : choice))
  }
  const approve = () => {
    const formAnswers = perm.requestKind === 'webmcp_trust_confirm' ? { scope: remember === 'always' ? 'always' : 'session' }
      // The desktop reads the lifetime from `scope`; a bare alwaysAllow means the project.
      : perm.requestKind === 'terminal_command_confirm' ? (remember ? { scope: remember === 'always' ? 'project' : 'session' } : undefined)
        : perm.requestKind === 'mcp_elicitation' ? schemaFormContent(fields, values)
          : editedPermissionAnswers(perm)
    props.onAllow(perm.requestId, formAnswers, allowRemember && remember === 'always' && (!isScoped || rememberingScoped), suggestions.size ? [...suggestions].sort((a, b) => a - b) : undefined)
  }
  const stepping = !lastStep && fields.length > 0
  const approveLabel = isScoped ? rememberingScoped ? 'Confirm & Remember' : 'Allow once'
    : stepping ? 'Next' : allowRemember && remember === 'always' ? presentation.alwaysLabel!
    : allowRemember && remember === 'session' && presentation.sessionLabel ? presentation.sessionLabel
      : `${presentation.approveLabel}${suggestions.size ? ` +${suggestions.size}` : ''}`
  return <PromptSheet title={title} icon={icon} onDismiss={deny} collapsed={props.collapsed} onCollapse={props.onCollapse && (() => props.onCollapse!(perm.requestId))} footer={<PromptActions
    approveLabel={approveLabel}
    rejectLabel={rememberingScoped ? 'Cancel' : unsupportedForm ? 'Dismiss' : feedback.trim() ? `${presentation.denyLabel} with feedback` : presentation.denyLabel}
    // A form's answer is not a verdict: brand submit beside a neutral decline, as on the desktop.
    tone={rememberingScoped || fields.length ? 'submit' : 'decision'}
    onApprove={stepping ? () => setStepIndex(stepIndex + 1) : approve}
    onBack={stepIndex > 0 ? () => setStepIndex(stepIndex - 1) : undefined} onReject={deny} disabled={Boolean(unsupportedForm) || Object.keys(stepErrors).length > 0 || !permissionEditsValid(perm) || Object.values(invalidFields).some(Boolean)}
    // An MCP decline carries no reason, so an elicitation asks for none, as on the desktop.
    feedback={rememberingScoped || unsupportedForm || perm.requestKind === 'mcp_elicitation' ? undefined : { value: feedback, onChange: setFeedback }}
  >{allowRemember && presentation.sessionLabel ? <PromptChoice multi label={t(presentation.sessionLabel)} selected={remember === 'session'} onPress={() => toggleRemember('session')} /> : null}
    {allowRemember && !rememberingScoped ? <PromptChoice multi label={t(isScoped ? 'Remember for This Project' : presentation.alwaysLabel!)} selected={remember === 'always'} onPress={() => toggleRemember('always')} /> : null}</PromptActions>}>
    {perm.elicitationUrl ? (
      <PromptPill
        label={t('Open in browser')}
        selected={false}
        onPress={() => { void Linking.openURL(perm.elicitationUrl!) }}
      />
    ) : null}
    <PermissionContent request={perm} remembering={rememberingScoped} />
    <PermissionEditors key={perm.requestId} loadSystemInfo={props.loadSystemInfo} request={perm} onChange={setDraft} onValidity={(key, valid) => setInvalidFields((current) => ({ ...current, [key]: !valid }))} />
    {unsupportedForm ? <View style={styles.warning}>
      <Text style={styles.body}>{t("SuperOne can't show this form")}</Text>
      <Text style={styles.meta}>{t('This form asks for input SuperOne does not support yet. Dismiss it to tell the server the form was not completed.')}</Text>
      <Text style={[styles.meta, { fontFamily: monospace }]}>{unsupportedForm.field ? `${unsupportedForm.field}: ${unsupportedForm.reason}` : unsupportedForm.reason}</Text>
    </View> : fields.length ? <>
      {steps.length > 1 ? <StepProgress current={stepIndex} total={steps.length} /> : null}
      <SchemaFormFields key={stepIndex} fields={step} values={values} errors={shownErrors} onChange={setField} />
    </> : null}
    {!perm.requestKind && perm.suggestions?.length ? <View style={styles.tight}>
      <Text style={styles.label}>{t('Permissions to remember')}</Text>
      {perm.suggestions.map((suggestion, index) => <PromptChoice key={index} multi label={permissionSuggestionLabel(suggestion)} selected={suggestions.has(index)} onPress={() => setSuggestions((current) => {
        const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next
      })} />)}
    </View> : null}
  </PromptSheet>
}

/** A segment per step, filled up to the current one; the step count is spoken, not shown. */
function StepProgress({ current, total }: { current: number; total: number }) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const label = t('Step {current} of {total}').replace('{current}', String(current + 1)).replace('{total}', String(total))
  return <View testID="prompt-step-progress" accessible accessibilityRole="progressbar" accessibilityLabel={label} style={{ flexDirection: 'row', gap: 4 }}>
    {Array.from({ length: total }, (_, index) => <View key={index} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: index <= current ? colors.primary : colors.border }} />)}
  </View>
}
