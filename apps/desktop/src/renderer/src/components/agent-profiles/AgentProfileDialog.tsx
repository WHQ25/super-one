import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { Input } from '@superone/ui/components/ui/input'
import { Textarea } from '@superone/ui/components/ui/textarea'
import { Label } from '@superone/ui/components/ui/label'
import { Alert, AlertDescription } from '@superone/ui/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import { AGENT_PROFILE_DESCRIPTION_MAX, AGENT_PROFILE_INSTRUCTIONS_MAX, AGENT_PROFILE_NAME_MAX, profileApprovalConfig, validateAgentProfileRuntime } from '@superone/shared/agent-profile'
import type { AgentProfileDraft } from '@superone/shared/agent-types'
import { parseManagedProfileDraft, type AgentProfileManagementAPI, type AgentProfileManagementDetail } from '@superone/shared/agent-profile-management'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { SettingsRow, SettingsSection } from '../settings/SettingsSection'
import { ProfileLaunchReview } from '../chat/ProfileLaunchReview'
import { ProfileRuntimeEditor } from './ProfileRuntimeEditor'

const P = 'settings.agentProfiles'

export function AgentProfileDialog({ detail: initialDetail, create, api, onClose, onSaved }: {
  detail: AgentProfileManagementDetail
  create: boolean
  api: AgentProfileManagementAPI
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const { t } = useTranslation()
  const [detail, setDetail] = useState(initialDetail)
  const [draft, setDraft] = useState<AgentProfileDraft>(() => ({
    name: create ? '' : detail.spec.identity.name,
    description: create ? '' : detail.spec.identity.description,
    instructions: create ? '' : detail.spec.instructions,
    ...(create ? {} : detail.spec.runtime),
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const parsed = parseManagedProfileDraft(draft, detail.harnessId)
  const runtimeErrors = parsed.ok ? validateAgentProfileRuntime(parsed.value.runtime, detail.catalog, {
    id: detail.harnessId, name: HARNESS_CAPABILITIES[detail.harnessId].displayName,
  }) : []
  const config = profileApprovalConfig(detail.harnessId, detail.catalog, detail.baseConfig, {
    model: draft.model, effort: draft.effort, permissionMode: draft.permissionMode, options: draft.options,
  })
  const onChange = (patch: Partial<AgentProfileDraft>) => setDraft((previous) => ({ ...previous, ...patch }))
  const refreshReview = async () => {
    setBusy(true)
    try { setDetail(await api.get(detail.id)); setError('') }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const save = async () => {
    if (!parsed.ok || runtimeErrors.length || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await api.save({
        ...(create ? {} : { id: detail.id }), sourceId: detail.id,
        version: detail.version, reviewToken: detail.reviewToken, draft,
      })
      onSaved(result.id)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" showCloseButton={!busy}>
      <DialogHeader>
        <DialogTitle>{t(`${P}.${create ? 'create' : 'edit'}`)}</DialogTitle>
        <DialogDescription>{HARNESS_CAPABILITIES[detail.harnessId].displayName}{detail.acpAgentId ? ` · ${detail.acpAgentId}` : ''}</DialogDescription>
      </DialogHeader>
      <form id="agent-profile-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <SettingsSection>
            <SettingsRow label={<Label htmlFor="profile-name">{t(`${P}.name`)}</Label>} footer={
              <Input id="profile-name" autoFocus value={draft.name} onChange={(event) => onChange({ name: event.target.value })} maxLength={AGENT_PROFILE_NAME_MAX} required />
            } />
            <SettingsRow label={<Label htmlFor="profile-description">{t(`${P}.description`)}</Label>} footer={
              <Textarea id="profile-description" value={draft.description} onChange={(event) => onChange({ description: event.target.value })} maxLength={AGENT_PROFILE_DESCRIPTION_MAX} rows={2} required />
            } />
            <SettingsRow label={<Label htmlFor="profile-instructions">{t(`${P}.instructions`)}</Label>} description={t(`${P}.instructionsHint`)} footer={
              <Textarea id="profile-instructions" value={draft.instructions ?? ''} onChange={(event) => onChange({ instructions: event.target.value })} maxLength={AGENT_PROFILE_INSTRUCTIONS_MAX} rows={5} />
            } />
          </SettingsSection>
          <SettingsSection title={t(`${P}.runtime`)} actions={
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ model: undefined, effort: undefined, permissionMode: undefined, options: undefined })}>{t(`${P}.resetRuntime`)}</Button>
          }>
            <div className="p-2">
              <ProfileRuntimeEditor harnessId={detail.harnessId} acpAgentId={detail.acpAgentId} catalogMode="profile" draft={draft} onChange={onChange} editor={{
                draft, catalog: detail.catalog, agent: { ...detail.agent, defaultConfig: detail.baseConfig },
              }} />
            </div>
          </SettingsSection>
          <SettingsSection title={t(`${P}.effectiveConfig`)}>
            <div className="p-3"><ProfileLaunchReview config={config} harnessId={detail.harnessId} acpAgentId={detail.acpAgentId} /></div>
          </SettingsSection>
          <p className="text-xs leading-relaxed text-muted-foreground">{t('chat.permission.agentProfile.approvalNote')}</p>
          {runtimeErrors.length > 0 && <Alert variant="destructive"><AlertDescription>{runtimeErrors.join(' ')}</AlertDescription></Alert>}
          {error && <Alert variant="destructive"><AlertDescription>{error}<Button type="button" variant="link" onClick={() => void refreshReview()} disabled={busy}>{t(`${P}.refreshReview`)}</Button></AlertDescription></Alert>}
        </fieldset>
      </form>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button type="submit" form="agent-profile-form" disabled={busy || !parsed.ok || runtimeErrors.length > 0}>
          {busy && <Loader2 className="size-4 animate-spin" />}{t(busy ? 'common.saving' : `${P}.saveAndApprove`)}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
