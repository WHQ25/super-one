import { useEffect, useMemo, useState } from 'react'
import { Linking, Switch, View } from 'react-native'
import { Text } from '../ui/text'
import type { HarnessId, RemoteSystemInfo, PermissionRequest } from '@superone/shared/agent-types'
import { elicitationAnswersAreValid, initialElicitationAnswers, permissionSheetPresentation, permissionSuggestionLabel } from '../permission-sheet-state'
import { permissionPromptTitle } from '../pending-prompt-state'
import { permissionPromptIcon } from './prompt-icon'
import { useMobileTheme } from '../theme/context'
import { PromptSheet } from './PromptSheet'
import { PromptActions, PromptChoice, PromptInput, PromptPill } from './PromptControls'
import { PermissionContent } from './PermissionContent'
import { PermissionEditors } from './PermissionEditors'
import { editablePermission, editedPermissionAnswers, permissionEditsValid } from './permission-edit-state'
import { showRememberPermission } from './prompt-content'
import { usePromptStyles } from './styles'
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
  const { tokens } = useMobileTheme()
  const { t } = useMobileLocale()
  const [draft, setDraft] = useState<PermissionRequest | null>(() => props.perm ? editablePermission(props.perm) : null)
  const [invalidFields, setInvalidFields] = useState<Record<string, boolean>>({})
  const perm = draft?.requestId === props.perm?.requestId ? draft : props.perm ? editablePermission(props.perm) : null
  useEffect(() => { setDraft(props.perm ? editablePermission(props.perm) : null); setInvalidFields({}) }, [props.perm])
  const fields = useMemo(() => perm?.elicitationForm ?? [], [perm?.elicitationForm])
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [feedback, setFeedback] = useState('')
  // Which remember choice is on: the prompt's "always" (project / persistent) or, for a
  // terminal command, the session-only lifetime. One at a time, like the desktop rows.
  const [remember, setRemember] = useState<'always' | 'session' | null>(null)
  const [suggestions, setSuggestions] = useState<Set<number>>(new Set())
  useEffect(() => {
    setValues(initialElicitationAnswers(fields)); setFeedback(''); setRemember(null); setSuggestions(new Set())
  }, [fields, perm?.requestId])
  if (!perm) return null
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
        : perm.requestKind === 'mcp_elicitation' ? Object.fromEntries(fields.map((field) => [field.name, field.type === 'number' && values[field.name] !== '' ? Number(values[field.name]) : values[field.name]]))
          : editedPermissionAnswers(perm)
    props.onAllow(perm.requestId, formAnswers, allowRemember && remember === 'always', suggestions.size ? [...suggestions].sort((a, b) => a - b) : undefined)
  }
  const approveLabel = allowRemember && remember === 'always' ? presentation.alwaysLabel!
    : allowRemember && remember === 'session' && presentation.sessionLabel ? presentation.sessionLabel
      : `${presentation.approveLabel}${suggestions.size ? ` +${suggestions.size}` : ''}`
  return <PromptSheet title={title} icon={icon} onDismiss={deny} collapsed={props.collapsed} onCollapse={props.onCollapse && (() => props.onCollapse!(perm.requestId))} footer={<PromptActions
    approveLabel={approveLabel}
    rejectLabel={feedback.trim() ? `${presentation.denyLabel} with feedback` : presentation.denyLabel}
    onApprove={approve} onReject={deny} disabled={!elicitationAnswersAreValid(fields, values) || !permissionEditsValid(perm) || Object.values(invalidFields).some(Boolean)}
    feedback={{ value: feedback, onChange: setFeedback }}
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
    {fields.map((field) => <View key={field.name} style={styles.tight}>
      <Text style={styles.body}>{field.label}{field.required ? ' *' : ''}</Text>
      {field.description ? <Text style={styles.meta}>{field.description}</Text> : null}
      {field.type === 'enum' ? <View style={styles.wrap}>{field.enumOptions?.map((option) => <PromptPill key={option} label={option} selected={values[field.name] === option} onPress={() => setValues((current) => ({ ...current, [field.name]: option }))} />)}</View>
        : field.type === 'boolean' ? <Switch testID={`prompt-field-${field.name}`} accessibilityLabel={field.label} value={Boolean(values[field.name])} trackColor={{ true: tokens.colors.primary }} onValueChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))} />
          : <PromptInput testID={`prompt-field-${field.name}`} accessibilityLabel={field.label} value={String(values[field.name] ?? '')} keyboardType={field.type === 'number' ? 'numeric' : 'default'} onChangeText={(value) => setValues((current) => ({ ...current, [field.name]: value }))} />}
    </View>)}
    {!perm.requestKind && perm.suggestions?.length ? <View style={styles.tight}>
      <Text style={styles.label}>{t('Permissions to remember')}</Text>
      {perm.suggestions.map((suggestion, index) => <PromptChoice key={index} multi label={permissionSuggestionLabel(suggestion)} selected={suggestions.has(index)} onPress={() => setSuggestions((current) => {
        const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next
      })} />)}
    </View> : null}
  </PromptSheet>
}
