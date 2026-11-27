import { useEffect, useState } from 'react'
import { Check, Lock, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_BROWSER_PROFILE_ID } from '@superone/shared/agent-types'
import { cn } from '@superone/ui/lib/utils'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@superone/ui/components/ui/hover-card'
import { useBrowserStore } from '@/stores/browser'
import { profileInitial, useBrowserProfilesStore } from '@/stores/browser-profiles'
import { useAppStore } from '@/stores/app'

export function BrowserProfileIndicator({ browserId, isHome }: { browserId: string; isHome: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const tab = useBrowserStore((s) => s.tabs[browserId])
  const setProfile = useBrowserStore((s) => s.setProfile)
  const profiles = useBrowserProfilesStore((s) => s.profiles)
  const userDefaultProfileId = useBrowserProfilesStore((s) => s.userDefaultProfileId)
  const agentDefaultProfileId = useBrowserProfilesStore((s) => s.agentDefaultProfileId)
  const loaded = useBrowserProfilesStore((s) => s.loaded)

  useEffect(() => {
    if (!loaded) void useBrowserProfilesStore.getState().load()
  }, [loaded])

  const currentProfileId = tab?.profileId ?? DEFAULT_BROWSER_PROFILE_ID
  const currentProfile = profiles.find((p) => p.id === currentProfileId) ?? profiles[0]
  const canSwitch = isHome && !tab?.canGoBack && !tab?.canGoForward

  const selectProfile = (profileId: string) => {
    if (!canSwitch || profileId === currentProfileId) return
    void window.app?.ensureBrowserProfileSession?.(profileId)
    setProfile(browserId, profileId)
    setOpen(false)
  }

  const openBrowserSettings = () => {
    setOpen(false)
    useAppStore.getState().setSettingsTab('browser')
    useAppStore.getState().navigateTo('settings')
  }

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={150} closeDelay={150}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={currentProfile?.name ?? 'Profile'}
          className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-muted/60 text-[10px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {profileInitial(currentProfile?.name ?? 'D')}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" sideOffset={6} className="w-64 p-2">
        <div className="flex items-center justify-between gap-2 px-1.5 py-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold text-foreground">
              {profileInitial(currentProfile?.name ?? 'D')}
            </span>
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-foreground">
                {currentProfile?.name ?? 'Default'}
              </div>
              <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                {currentProfile?.id === userDefaultProfileId && (
                  <span>{t('chat.browser.profileUserDefault', 'User Default')}</span>
                )}
                {currentProfile?.id === agentDefaultProfileId && (
                  <span>{t('chat.browser.profileAgentDefault', 'Agent Default')}</span>
                )}
                {currentProfile && !currentProfile.shareWithAgent && (
                  <span>{t('chat.browser.profilePrivate', 'Private')}</span>
                )}
              </div>
            </div>
          </div>
          {!canSwitch && <Lock className="size-3.5 shrink-0 text-muted-foreground" />}
        </div>

        <div className="my-1.5 h-px bg-border" />

        {canSwitch ? (
          <div className="grid gap-0.5">
            <div className="px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {t('chat.browser.profileSwitch', 'Switch Profile')}
            </div>
            {profiles.map((p) => {
              const active = p.id === currentProfileId
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectProfile(p.id)}
                  className={cn(
                    'flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm px-1.5 py-1 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground',
                    active && 'bg-accent/60 font-medium',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
                      {profileInitial(p.name)}
                    </span>
                    <span className="truncate">{p.name}</span>
                  </span>
                  {active && <Check className="size-3.5 shrink-0 text-primary" />}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="px-1.5 py-1 text-[11px] leading-snug text-muted-foreground">
            {t('chat.browser.profileLockedHint', 'Profiles can only be switched on a new tab before loading a page.')}
          </p>
        )}

        <div className="my-1.5 h-px bg-border" />

        <button
          type="button"
          onClick={openBrowserSettings}
          className="flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Settings2 className="size-3.5 shrink-0" />
          <span>{t('chat.browser.profileManage', 'Manage Profiles')}</span>
        </button>
      </HoverCardContent>
    </HoverCard>
  )
}
