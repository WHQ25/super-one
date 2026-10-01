import { useEffect, useMemo, useState } from 'react'
import { Linking, View } from 'react-native'
import { Text } from '../ui/text'
import type { HarnessId, RemoteSystemInfo, PermissionRequest } from '@superone/shared/agent-types'
import { initialSchemaFormValues, schemaFormContent, validateSchemaForm, type SchemaFormValue, type SchemaFormValues } from '@superone/shared/schema-form'
import { permissionSchemaForm, permissionSheetPresentation, permissionSuggestionLabel } from '../permission-sheet-state'
import { permissionPromptTitle } from '../pending-prompt-state'
import { permissionPromptIcon } from './prompt-icon'
import { PromptSheet } from './PromptSheet'
import { PromptActions, PromptChoice, PromptPill } from './PromptControls'
import { PermissionContent } from './PermissionContent'
import { PermissionEditors } from './PermissionEditors'
import { editablePermission, editedPermissionAnswers, permissionEditsValid } from './permission-edit-state'
import { showRememberPermission } from './prompt-content'
import { monospace, usePromptStyles } from './styles'
import { SchemaFormFields } from './SchemaFormFields'
import { useMobileLocale } from '../i18n/context'

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
  const [values, setValues] = useState<SchemaFormValues>({})
  // Errors show per field once it is edited; the approve button stays off until all pass.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())
  const [feedback, setFeedback] = useState('')
  // Which remember choice is on: the prompt's "always" (project / persistent) or, for a
  // terminal command, the session-only lifetime. One at a time, like the desktop rows.
  const [remember, setRemember] = useState<'always' | 'session' | null>(null)
  const [suggestions, setSuggestions] = useState<Set<number>>(new Set())
  useEffect(() => {
    setValues(initialSchemaFormValues(fields)); setTouched(new Set()); setFeedback(''); setRemember(null); setSuggestions(new Set())
  }, [fields, perm?.requestId])
  const formErrors = validateSchemaForm(fields, values)
  if (!perm) return null
  const unsupportedForm = form && !form.supported ? form : null
  const presentation = permissionSheetPresentation(perm)
  const allowRemember = Boolean(presentation.alwaysLabel && showRememberPermission(perm))
  const icon = permissionPromptIcon(perm)
  const title = permissionPromptTitle(perm)
  const deny = () => props.onDeny(perm.requestId, feedback.trim() || undefined)
  const toggleRemember = (choice: 'always' | 'session') => setRemember((current) => (current === choice ? null : choice))
  const approve = () => {
    const formAnswers = perm.requestKind === 'webmcp_trust_confirm' ? { scope: remember === 'always' ? 'always' : 'session' }
      // The desktop reads the lifetime from `scope`; a bare alwaysAllow means the project.
      : perm.requestKind === 'terminal_command_confirm' ? (remember ? { scope: remember === 'always' ? 'project' : 'session' } : undefined)
        : perm.requestKind === 'mcp_elicitation' ? schemaFormContent(fields, values)
          : editedPermissionAnswers(perm)
    props.onAllow(perm.requestId, formAnswers, allowRemember && remember === 'always', suggestions.size ? [...suggestions].sort((a, b) => a - b) : undefined)
  }
  const approveLabel = allowRemember && remember === 'always' ? presentation.alwaysLabel!
    : allowRemember && remember === 'session' && presentation.sessionLabel ? presentation.sessionLabel
      : `${presentation.approveLabel}${suggestions.size ? ` +${suggestions.size}` : ''}`
  return <PromptSheet title={title} icon={icon} onDismiss={deny} collapsed={props.collapsed} onCollapse={props.onCollapse && (() => props.onCollapse!(perm.requestId))} footer={<PromptActions
    approveLabel={approveLabel}
    rejectLabel={unsupportedForm ? 'Dismiss' : feedback.trim() ? `${presentation.denyLabel} with feedback` : presentation.denyLabel}
    onApprove={approve} onReject={deny} disabled={Boolean(unsupportedForm) || Object.keys(formErrors).length > 0 || !permissionEditsValid(perm) || Object.values(invalidFields).some(Boolean)}
    feedback={unsupportedForm ? undefined : { value: feedback, onChange: setFeedback }}
  >{allowRemember && presentation.sessionLabel ? <PromptChoice multi label={t(presentation.sessionLabel)} selected={remember === 'session'} onPress={() => toggleRemember('session')} /> : null}
    {allowRemember ? <PromptChoice multi label={t(presentation.alwaysLabel!)} selected={remember === 'always'} onPress={() => toggleRemember('always')} /> : null}</PromptActions>}>
    {perm.elicitationUrl ? (
      <PromptPill
        label={t('Open in browser')}
        selected={false}
        onPress={() => { void Linking.openURL(perm.elicitationUrl!) }}
      />
    ) : null}
    <PermissionContent request={perm} />
    <PermissionEditors key={perm.requestId} loadSystemInfo={props.loadSystemInfo} request={perm} onChange={setDraft} onValidity={(key, valid) => setInvalidFields((current) => ({ ...current, [key]: !valid }))} />
    {unsupportedForm ? <View style={styles.warning}>
      <Text style={styles.body}>{t("SuperOne can't show this form")}</Text>
      <Text style={styles.meta}>{t('This form asks for input SuperOne does not support yet. Dismiss it to tell the server the form was not completed.')}</Text>
      <Text style={[styles.meta, { fontFamily: monospace }]}>{unsupportedForm.field ? `${unsupportedForm.field}: ${unsupportedForm.reason}` : unsupportedForm.reason}</Text>
    </View> : fields.length ? <SchemaFormFields fields={fields} values={values} errors={Object.fromEntries(Object.entries(formErrors).filter(([name]) => touched.has(name)))}
      onChange={(name: string, value: SchemaFormValue | undefined) => { setValues((current) => ({ ...current, [name]: value })); setTouched((current) => new Set(current).add(name)) }} /> : null}
    {!perm.requestKind && perm.suggestions?.length ? <View style={styles.tight}>
      <Text style={styles.label}>{t('Permissions to remember')}</Text>
      {perm.suggestions.map((suggestion, index) => <PromptChoice key={index} multi label={permissionSuggestionLabel(suggestion)} selected={suggestions.has(index)} onPress={() => setSuggestions((current) => {
        const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next
      })} />)}
    </View> : null}
  </PromptSheet>
}
