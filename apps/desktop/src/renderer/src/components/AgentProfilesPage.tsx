import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Loader2, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Badge } from '@superone/ui/components/ui/badge'
import { Alert, AlertDescription } from '@superone/ui/components/ui/alert'
import { Skeleton } from '@superone/ui/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import type { AgentProfileManagementAPI, AgentProfileManagementDetail, ManagedAgentProfile } from '@superone/shared/agent-profile-management'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { useAppStore } from '@/stores/app'
import { catalogIdForSessionProvider } from '@/lib/harness-visibility'
import { SettingsNavGroup, SettingsNavItem } from './settings/SettingsNav'
import { SettingsPage, SettingsSection } from './settings/SettingsSection'
import { ProfileLaunchReview } from './chat/ProfileLaunchReview'
import { HarnessGlyph } from './chat/launch-settings-bar'
import { AgentProfileDialog } from './agent-profiles/AgentProfileDialog'

const P = 'settings.agentProfiles'
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

export function AgentProfilesPage({ api = window.app.agentProfiles }: { api?: AgentProfileManagementAPI }) {
  const { t } = useTranslation()
  const [profiles, setProfiles] = useState<ManagedAgentProfile[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<AgentProfileManagementDetail | null>(null)
  const [detailError, setDetailError] = useState('')
  const [revision, setRevision] = useState(0)
  const [editor, setEditor] = useState<{ detail: AgentProfileManagementDetail; create: boolean } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const listRevision = useRef(0)
  const load = useCallback(async (preferred?: string, quiet = false) => {
    const current = ++listRevision.current
    if (!quiet) setLoading(true)
    setError('')
    try {
      const rows = await api.list()
      if (listRevision.current !== current) return
      setProfiles(rows)
      setSelected((previous) => rows.some((row) => row.id === (preferred ?? previous)) ? preferred ?? previous : rows[0]?.id ?? '')
      setRevision((value) => value + 1)
    } catch (error) {
      if (listRevision.current === current) setError(message(error))
    } finally {
      if (listRevision.current === current) setLoading(false)
    }
  }, [api])
  useEffect(() => { void load(); return () => { ++listRevision.current } }, [load])
  useEffect(() => {
    const refresh = () => { void load(undefined, true) }
    const unsubscribe = window.app.onAppSettingsChange?.(refresh)
    window.addEventListener('focus', refresh)
    return () => { unsubscribe?.(); window.removeEventListener('focus', refresh) }
  }, [load])
  useEffect(() => {
    let active = true
    setDetail((current) => current?.id === selected ? current : null)
    setDetailError('')
    if (selected) void api.get(selected).then((value) => { if (active) setDetail(value) }).catch((error) => { if (active) setDetailError(message(error)) })
    return () => { active = false }
  }, [api, selected, revision])
  const configure = (profile: ManagedAgentProfile) => {
    const key = catalogIdForSessionProvider(profile.harnessId, profile.acpAgentId) ?? `acp:${profile.acpAgentId}`
    useAppStore.getState().openHarnessSettings(key)
    useAppStore.getState().setHarnessConfigSection('preferences')
  }
  const remove = async () => {
    if (!detail || busy) return
    setBusy(true)
    setDetailError('')
    try {
      await api.delete({ id: detail.id, version: detail.version })
      setDeleting(false)
      await load()
    } catch (error) { setDetailError(message(error)); setDeleting(false) }
    finally { setBusy(false) }
  }
  return <div className="@container h-full">
    <SettingsPage title={t(`${P}.title`)} description={t(`${P}.subtitle`)} className="max-w-5xl" actions={<>
      <IconButton tooltip={t('common.refresh')} aria-label={t('common.refresh')} onClick={() => void load()} disabled={loading || busy}><RefreshCw className="size-4" /></IconButton>
      <Button size="sm" disabled={!detail || loading || busy} onClick={() => detail && setEditor({ detail, create: true })}><Plus className="size-4" />{t(`${P}.create`)}</Button>
    </>}>
      {error ? <Alert variant="destructive"><AlertDescription>{error}<Button variant="link" onClick={() => void load()}>{t('common.retry')}</Button></AlertDescription></Alert> : loading ? <div className="space-y-3" aria-label={t('common.loading')}><Skeleton className="h-10 w-48" /><Skeleton className="h-48 w-full" /></div> : <div className="grid min-w-0 gap-6 @3xl:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label={t(`${P}.title`)}>
          {[true, false].map((defaults) => <SettingsNavGroup key={String(defaults)} label={t(`${P}.${defaults ? 'defaults' : 'saved'}`)}>
            {profiles.filter((profile) => profile.followsDefaults === defaults).map((profile) => <SettingsNavItem key={profile.id} selected={selected === profile.id} dimmed={!profile.available} onClick={() => setSelected(profile.id)} icon={<HarnessGlyph profile={profile} />}>
              {profile.name}
            </SettingsNavItem>)}
            {!profiles.some((profile) => profile.followsDefaults === defaults) && <p className="px-3 py-2 text-xs text-muted-foreground">{t(`${P}.${defaults ? 'noProfiles' : 'noSaved'}`)}</p>}
          </SettingsNavGroup>)}
        </nav>
        <div className="min-w-0 space-y-5">
          {detailError && <Alert variant="destructive"><AlertDescription>{detailError}<Button variant="link" onClick={() => void load(selected)}>{t('common.retry')}</Button></AlertDescription></Alert>}
          {!detail && selected && !detailError && <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t('common.loading')}</div>}
          {detail && <>
            <div className="flex flex-wrap items-start justify-between gap-3 pt-4">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-lg font-semibold">{detail.name}</h3><Badge variant="secondary">{t(`${P}.${detail.followsDefaults ? 'defaultBadge' : detail.approved ? 'approved' : 'needsReview'}`)}</Badge>{!detail.available && <Badge variant="outline">{t(`${P}.unavailable`)}</Badge>}</div>
                <p className="text-xs text-muted-foreground">{HARNESS_CAPABILITIES[detail.harnessId].displayName}</p>
              </div>
              <div className="flex gap-2">
                {detail.followsDefaults ? <Button size="sm" variant="outline" onClick={() => configure(detail)}>{t(`${P}.configureDefaults`)}</Button> : <>
                  <Button size="sm" variant="outline" onClick={() => setEditor({ detail, create: false })}>{t('common.edit')}</Button>
                  <Button size="sm" variant="outline" onClick={() => setDeleting(true)}>{t('common.delete')}</Button>
                </>}
              </div>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{detail.followsDefaults ? t(`${P}.defaultHint`) : detail.description}</p>
            <SettingsSection title={t(`${P}.effectiveConfig`)}><div className="p-3"><ProfileLaunchReview config={detail.agent.defaultConfig} harnessId={detail.harnessId} acpAgentId={detail.acpAgentId} /></div></SettingsSection>
            {!detail.followsDefaults && <SettingsSection title={t(`${P}.instructions`)}><p className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words p-3 text-sm">{detail.spec.instructions || t(`${P}.noInstructions`)}</p></SettingsSection>}
            <p className="text-xs leading-relaxed text-muted-foreground">{t(`${P}.${detail.followsDefaults ? 'defaultApproval' : detail.approved ? 'approvedHint' : 'reviewHint'}`)}</p>
          </>}
          {!selected && <div className="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground"><Bot className="size-8" /><p>{t(`${P}.noProfiles`)}</p></div>}
        </div>
      </div>}
    </SettingsPage>
    {editor && <AgentProfileDialog detail={editor.detail} create={editor.create} api={api} onClose={() => setEditor(null)} onSaved={(id) => { setEditor(null); void load(id) }} />}
    <Dialog open={deleting} onOpenChange={(open) => { if (!busy) setDeleting(open) }}>
      <DialogContent showCloseButton={!busy}><DialogHeader><DialogTitle>{t(`${P}.deleteTitle`, { name: detail?.name })}</DialogTitle><DialogDescription>{t(`${P}.deleteHint`)}</DialogDescription></DialogHeader><DialogFooter>
        <Button variant="outline" onClick={() => setDeleting(false)} disabled={busy}>{t('common.cancel')}</Button><Button variant="destructive" onClick={() => void remove()} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />}{t('common.delete')}</Button>
      </DialogFooter></DialogContent>
    </Dialog>
  </div>
}
