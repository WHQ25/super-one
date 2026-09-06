import { useEffect, useMemo, useState } from 'react'
import { Switch, View } from 'react-native'
import { Text } from '../ui/text'
import { Bot, CalendarClock, FilePenLine, FileText, Globe, Monitor, Plug, Settings2, ShieldAlert, Smartphone, Terminal, Trash2, Video, type LucideIcon } from 'lucide-react-native'
import type { HarnessId, RemoteSystemInfo, PermissionRequest } from '@superone/shared/agent-types'
import { elicitationAnswersAreValid, initialElicitationAnswers, permissionSheetPresentation, permissionSuggestionLabel } from '../permission-sheet-state'
import { useMobileTheme } from '../theme/context'
import { PromptSheet } from './PromptSheet'
import { PromptActions, PromptChoice, PromptInput, PromptPill } from './PromptControls'
import { PermissionContent } from './PermissionContent'
import { PermissionEditors } from './PermissionEditors'
import { editablePermission, editedPermissionAnswers, permissionEditsValid } from './permission-edit-state'
import { showRememberPermission } from './prompt-content'
import { usePromptStyles } from './styles'

const kindIcons: Record<NonNullable<PermissionRequest['requestKind']>, LucideIcon> = {
  mcp_elicitation: Plug, video_gen_confirm: Video, config_confirm: Settings2,
  session_agents_confirm: Bot, computer_use_grant: Monitor, session_cleanup_confirm: Trash2,
  automation_confirm: CalendarClock, webmcp_trust_confirm: Globe, device_control_confirm: Smartphone,
}

export function PermissionSheet(props: {
  perm: PermissionRequest | null
  loadSystemInfo?: (harness: HarnessId) => Promise<RemoteSystemInfo>
  onAllow: (id: string, formAnswers?: Record<string, unknown>, alwaysAllow?: boolean, selectedSuggestions?: number[]) => void
  onDeny: (id: string, reason?: string) => void
}) {
  const styles = usePromptStyles()
  const { tokens } = useMobileTheme()
  const [draft, setDraft] = useState<PermissionRequest | null>(() => props.perm ? editablePermission(props.perm) : null)
  const [invalidFields, setInvalidFields] = useState<Record<string, boolean>>({})
  const perm = draft?.requestId === props.perm?.requestId ? draft : props.perm ? editablePermission(props.perm) : null
  useEffect(() => { setDraft(props.perm ? editablePermission(props.perm) : null); setInvalidFields({}) }, [props.perm])
  const fields = useMemo(() => perm?.elicitationForm ?? [], [perm?.elicitationForm])
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [feedback, setFeedback] = useState('')
  const [remember, setRemember] = useState(false)
  const [suggestions, setSuggestions] = useState<Set<number>>(new Set())
  useEffect(() => {
    setValues(initialElicitationAnswers(fields)); setFeedback(''); setRemember(false); setSuggestions(new Set())
  }, [fields, perm?.requestId])
  if (!perm) return null
  const presentation = permissionSheetPresentation(perm)
  const allowRemember = Boolean(presentation.alwaysLabel && showRememberPermission(perm))
  const icon = perm.requestKind ? kindIcons[perm.requestKind] : perm.toolName === 'Bash' ? Terminal : perm.toolName === 'SandboxNetworkAccess' ? ShieldAlert : /Edit|Write/.test(perm.toolName) ? FilePenLine : perm.toolName === 'Read' ? FileText : Plug
  const title = perm.requestKind ? presentation.title : perm.toolName === 'SandboxNetworkAccess' ? 'Allow sandbox network access' : perm.toolName.replace(/^mcp__.*?__/, '').replaceAll('_', ' ')
  const deny = () => props.onDeny(perm.requestId, feedback.trim() || undefined)
  const approve = () => {
    const formAnswers = perm.requestKind === 'webmcp_trust_confirm' ? { scope: remember ? 'always' : 'session' }
      : perm.requestKind === 'mcp_elicitation' ? Object.fromEntries(fields.map((field) => [field.name, field.type === 'number' && values[field.name] !== '' ? Number(values[field.name]) : values[field.name]]))
        : editedPermissionAnswers(perm)
    props.onAllow(perm.requestId, formAnswers, allowRemember && remember, suggestions.size ? [...suggestions].sort((a, b) => a - b) : undefined)
  }
  return <PromptSheet title={title} icon={icon} onDismiss={deny} footer={<PromptActions
    approveLabel={remember && allowRemember ? presentation.alwaysLabel! : `${presentation.approveLabel}${suggestions.size ? ` +${suggestions.size}` : ''}`}
    rejectLabel={feedback.trim() ? `${presentation.denyLabel} with feedback` : presentation.denyLabel}
    onApprove={approve} onReject={deny} disabled={!elicitationAnswersAreValid(fields, values) || !permissionEditsValid(perm) || Object.values(invalidFields).some(Boolean)}
    destructive={presentation.destructive}
    feedback={{ value: feedback, onChange: setFeedback }}
  >{allowRemember ? <PromptChoice multi label={presentation.alwaysLabel!} selected={remember} onPress={() => setRemember(!remember)} /> : null}</PromptActions>}>
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
      <Text style={styles.label}>Permissions to remember</Text>
      {perm.suggestions.map((suggestion, index) => <PromptChoice key={index} multi label={permissionSuggestionLabel(suggestion)} selected={suggestions.has(index)} onPress={() => setSuggestions((current) => {
        const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next
      })} />)}
    </View> : null}
  </PromptSheet>
}
