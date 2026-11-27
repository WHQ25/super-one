import { useEffect, useState, type KeyboardEvent } from 'react'
import { Bot, ChevronRight, Plus, RotateCcw, Trash2, User } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { DEFAULT_BROWSER_PROFILE_ID, type BrowserProfile } from '@superone/shared/agent-types'
import { Button } from '@superone/ui/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import { Input } from '@superone/ui/components/ui/input'
import { Switch } from '@superone/ui/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { SettingsFootnote } from '@/components/settings/SettingsFootnote'
import { SettingsRow, SettingsSection, settingsRowClassName } from '@/components/settings/SettingsSection'
import { closeBrowserTab } from '@/components/activity/activity-panel-api'
import { useBrowserStore } from '@/stores/browser'
import { profileInitial, useBrowserProfilesStore } from '@/stores/browser-profiles'

function isImeComposing(e: KeyboardEvent<HTMLInputElement>): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229
}

export function BrowserProfilesSettingsSection() {
  const { t } = useTranslation()
  const enabled = useBrowserProfilesStore((s) => s.enabled)
  const profiles = useBrowserProfilesStore((s) => s.profiles)
  const userDefaultProfileId = useBrowserProfilesStore((s) => s.userDefaultProfileId)
  const agentDefaultProfileId = useBrowserProfilesStore((s) => s.agentDefaultProfileId)
  const loaded = useBrowserProfilesStore((s) => s.loaded)
  const {
    setEnabled,
    createProfile,
    renameProfile,
    toggleShareWithAgent,
    setUserDefault,
    setAgentDefault,
    deleteProfile,
    clearProfileData,
  } = useBrowserProfilesStore.getState()

  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createShare, setCreateShare] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [detailProfileId, setDetailProfileId] = useState<string | null>(null)
  const [detailName, setDetailName] = useState('')
  const [detailError, setDetailError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!loaded) void useBrowserProfilesStore.getState().load()
  }, [loaded])

  const detailProfile = detailProfileId ? profiles.find((p) => p.id === detailProfileId) ?? null : null

  function openDetail(profile: BrowserProfile) {
    setDetailProfileId(profile.id)
    setDetailName(profile.name)
    setDetailError(null)
    setConfirmDelete(false)
  }

  async function handleCreate() {
    setBusy(true)
    setCreateError(null)
    try {
      await createProfile(createName, createShare)
      setCreateOpen(false)
      setCreateName('')
      setCreateShare(false)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveName() {
    if (!detailProfile) return
    const trimmed = detailName.trim()
    if (!trimmed || trimmed === detailProfile.name) return
    setBusy(true)
    setDetailError(null)
    try {
      await renameProfile(detailProfile.id, trimmed)
      toast.success(t('settings.browser.profiles.renamed', 'Profile renamed'))
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!detailProfile) return
    setBusy(true)
    try {
      const targetId = detailProfile.id
      const tabs = useBrowserStore.getState().tabs
      for (const [tabId, tab] of Object.entries(tabs)) {
        if (tab.profileId === targetId) {
          closeBrowserTab(tabId)
        }
      }
      await deleteProfile(targetId)
      setDetailProfileId(null)
      setConfirmDelete(false)
      toast.success(t('settings.browser.profiles.deleted', 'Profile deleted'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleClearData() {
    if (!detailProfile) return
    setBusy(true)
    try {
      await clearProfileData(detailProfile.id)
      toast.success(t('settings.browser.profiles.cleared', 'Profile data cleared'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <SettingsSection
        title={t('settings.browser.profiles.title', 'Profiles')}
        actions={enabled ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1"
            onClick={() => {
              setCreateName('')
              setCreateShare(false)
              setCreateError(null)
              setCreateOpen(true)
            }}
          >
            <Plus className="size-3.5" />
            {t('settings.browser.profiles.create', 'New Profile')}
          </Button>
        ) : undefined}
      >
        <SettingsRow
          label={t('settings.browser.profiles.enable', 'Enable Multiple Profiles')}
          description={t('settings.browser.profiles.description', 'Isolate cookies, logins, and site storage per profile.')}
        >
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => void setEnabled(checked)}
            disabled={busy}
          />
        </SettingsRow>

        {enabled && (
          <TooltipProvider delayDuration={300}>
            {profiles.map((profile) => {
              const isUserDefault = profile.id === userDefaultProfileId
              const isAgentDefault = profile.id === agentDefaultProfileId
              const agentTip = isAgentDefault
                ? t('settings.browser.profiles.badgeAgent', 'Agent Default')
                : t('settings.browser.profiles.sharedDesc', 'Available to Agent')
              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => openDetail(profile)}
                  className={`${settingsRowClassName} flex w-full cursor-pointer items-center justify-between gap-4 text-left transition-colors hover:bg-muted/70`}
                >
                  <span className="inline-flex min-w-0 items-center gap-2 text-sm">
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[10px] font-semibold">
                      {profileInitial(profile.name)}
                    </span>
                    <span className="truncate">{profile.name}</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-2">
                    {isUserDefault && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            aria-label={t('settings.browser.profiles.badgeUser', 'User Default')}
                            className="inline-flex items-center text-primary"
                          >
                            <User className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {t('settings.browser.profiles.badgeUser', 'User Default')}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {profile.shareWithAgent && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            aria-label={agentTip}
                            className={isAgentDefault ? 'inline-flex items-center text-primary' : 'inline-flex items-center text-muted-foreground'}
                          >
                            <Bot className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {agentTip}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </span>
                </button>
              )
            })}
          </TooltipProvider>
        )}
      </SettingsSection>
      {enabled && (
        <SettingsFootnote>
          {t('settings.browser.profiles.footnote', 'Bookmarks and download history are shared across profiles.')}
        </SettingsFootnote>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('settings.browser.profiles.createTitle', 'New Profile')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <Input
              autoFocus
              value={createName}
              placeholder={t('settings.browser.profiles.namePlaceholder', 'e.g. Work, Testing')}
              onChange={(e) => {
                setCreateName(e.target.value)
                setCreateError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isImeComposing(e) && createName.trim() && !busy) {
                  void handleCreate()
                }
              }}
            />
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Bot className="size-4 shrink-0" />
                <span>{t('settings.browser.profiles.shareOnCreate', 'Allow Agent to Use This Profile')}</span>
              </span>
              <Switch checked={createShare} onCheckedChange={setCreateShare} />
            </label>
            {createError && <p className="text-xs text-destructive">{createError}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button size="sm" disabled={!createName.trim() || busy} onClick={() => void handleCreate()}>
              {t('common.create', 'Create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailProfile} onOpenChange={(o) => { if (!o) { setDetailProfileId(null); setConfirmDelete(false) } }}>
        {detailProfile && (
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold">
                  {profileInitial(detailProfile.name)}
                </span>
                <span className="truncate">{detailProfile.name}</span>
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-1">
              <div className="grid gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('settings.browser.profiles.nameLabel', 'Name')}
                </span>
                <div className="flex items-center gap-2">
                  <Input
                    value={detailName}
                    onChange={(e) => {
                      setDetailName(e.target.value)
                      setDetailError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isImeComposing(e) && detailName.trim() && detailName.trim() !== detailProfile.name && !busy) {
                        void handleSaveName()
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !detailName.trim() || detailName.trim() === detailProfile.name}
                    onClick={() => void handleSaveName()}
                  >
                    {t('common.save', 'Save')}
                  </Button>
                </div>
                {detailError && <p className="text-xs text-destructive">{detailError}</p>}
              </div>

              <div className="h-px bg-border" />

              <label className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <Bot className="size-4 text-muted-foreground" />
                  <span>{t('settings.browser.profiles.shareOnCreate', 'Allow Agent to Use This Profile')}</span>
                </span>
                <Switch
                  checked={detailProfile.shareWithAgent}
                  onCheckedChange={(checked) => void toggleShareWithAgent(detailProfile.id, checked)}
                  disabled={busy}
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={detailProfile.id === userDefaultProfileId ? 'default' : 'outline'}
                  disabled={busy || detailProfile.id === userDefaultProfileId}
                  onClick={() => void setUserDefault(detailProfile.id)}
                  className="gap-1.5 text-xs"
                >
                  <User className="size-3.5" />
                  {detailProfile.id === userDefaultProfileId
                    ? t('settings.browser.profiles.badgeUser', 'User Default')
                    : t('settings.browser.profiles.setUserDefault', 'Set User Default')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={detailProfile.id === agentDefaultProfileId ? 'default' : 'outline'}
                  disabled={busy || !detailProfile.shareWithAgent || detailProfile.id === agentDefaultProfileId}
                  onClick={() => void setAgentDefault(detailProfile.id)}
                  className="gap-1.5 text-xs"
                >
                  <Bot className="size-3.5" />
                  {detailProfile.id === agentDefaultProfileId
                    ? t('settings.browser.profiles.badgeAgent', 'Agent Default')
                    : t('settings.browser.profiles.setAgentDefault', 'Set Agent Default')}
                </Button>
              </div>

              <div className="h-px bg-border" />

              {!confirmDelete ? (
                <div className="flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void handleClearData()}
                    className="gap-1.5 text-xs"
                  >
                    <RotateCcw className="size-3.5" />
                    {t('settings.browser.profiles.clearData', 'Clear Profile Data')}
                  </Button>
                  {detailProfile.id !== DEFAULT_BROWSER_PROFILE_ID && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setConfirmDelete(true)}
                      className="gap-1.5 text-xs text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                      {t('common.delete', 'Delete')}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="grid gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t('settings.browser.profiles.deleteConfirm', {
                      name: detailProfile.name,
                      defaultValue: `Deleting "${detailProfile.name}" will close any open tabs using it and clear all its cookies and site storage.`,
                    })}
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>
                      {t('common.cancel', 'Cancel')}
                    </Button>
                    <Button size="sm" variant="destructive" disabled={busy} onClick={() => void handleDelete()}>
                      {t('common.delete', 'Delete')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
