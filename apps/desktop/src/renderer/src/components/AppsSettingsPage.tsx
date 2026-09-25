import { type ReactNode, useEffect, useState } from 'react'
import { ArrowLeft, ChevronRight, Link, Trash2, Mic, Video, Globe, Library, AlertTriangle, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Switch } from '@superone/ui/components/ui/switch'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import { settingsSelectTriggerClassName } from '@/components/settings/select-trigger-class'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { DevAppLibraryView } from '@/components/DevAppLibraryView'
import { SettingsCard, SettingsPage, SettingsRow, SettingsSection, settingsRowClassName } from '@/components/settings/SettingsSection'
import { SettingsFootnote } from '@/components/settings/SettingsFootnote'
import { useMiniAppStore } from '@/stores/miniapp'
import { useAppStore } from '@/stores/app'
import { hasAnyPermission } from '@/lib/miniapp-permissions'
import type { MiniAppEntry } from '@superone/shared/miniapp-types'

function AppRow({ app, onClick }: { app: MiniAppEntry; onClick: () => void }) {
  const { t } = useTranslation()
  const tools = app.manifest.tools ?? []
  const toolCount = tools.length

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        settingsRowClassName,
        'flex w-full items-center gap-3 text-left transition-colors hover:bg-muted/60',
      )}
    >
      <MiniAppIcon appId={app.id} className="size-8 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm">{app.manifest.name}</p>
          {app.orphan && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-warning/10 px-1 text-[10px] text-warning">
              <AlertTriangle className="size-2.5" />
              {t('resources.devAppLibrary.orphanBadge')}
            </span>
          )}
          {app.manifest.isDev && <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">dev</span>}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {toolCount > 0 ? t('resources.apps.toolCount', { count: toolCount }) : t('resources.apps.noTools')}
          {app.manifest.version && ` · v${app.manifest.version}`}
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

function AppSection({ title, apps, onSelect }: { title: string; apps: MiniAppEntry[]; onSelect: (app: MiniAppEntry) => void }) {
  if (apps.length === 0) return null
  return (
    <SettingsSection title={title}>
      {apps.map((app) => (
        <AppRow key={app.id} app={app} onClick={() => onSelect(app)} />
      ))}
    </SettingsSection>
  )
}

/** One declared capability: icon, name and the app's stated reason. */
function PermissionRow({ icon, label, reason }: { icon: ReactNode; label: ReactNode; reason?: string }) {
  return (
    <div className={cn(settingsRowClassName, 'flex items-center gap-3')}>
      {icon}
      <div className="min-w-0 flex-1">
        <div className="text-sm">{label}</div>
        {reason && <div className="mt-0.5 text-xs text-muted-foreground">{reason}</div>}
      </div>
    </div>
  )
}

function AppDetailPage({ app, onBack }: { app: MiniAppEntry; onBack: () => void }) {
  const { t } = useTranslation()
  const uninstallApp = useMiniAppStore((s) => s.uninstallApp)
  const [preapproved, setPreapproved] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setLoading(true)
    window.miniapp.getPreapproved(app.id).then((tools) => {
      setPreapproved(tools)
      setLoading(false)
    })
  }, [app.id])

  const toggleTool = async (toolName: string, enabled: boolean) => {
    const next = enabled
      ? [...preapproved, toolName]
      : preapproved.filter((t) => t !== toolName)
    setPreapproved(next)
    await window.miniapp.setPreapproved(app.id, next)
  }

  const handleUninstall = async () => {
    try {
      await uninstallApp(app.id, app.installDir)
      onBack()
      toast.success(t('resources.apps.uninstalled', { name: app.manifest.name }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('resources.apps.uninstallFailed'))
    }
  }

  const tools = app.manifest.tools ?? []
  const { manifest } = app
  const hasPermissions = hasAnyPermission(manifest)

  return (
    <div className="px-7 pt-5 pb-8">
      <div className="mx-auto max-w-3xl">
        <Button variant="ghost" size="sm" className="-ml-2 mb-3 h-7 text-muted-foreground" onClick={onBack}>
          <ArrowLeft className="size-3.5" />
          {t('common.back')}
        </Button>

        {/* App header */}
        <div className="mb-6 flex items-center gap-4">
          <MiniAppIcon appId={app.id} className="size-14 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-xl font-semibold">{manifest.name}</h2>
              {manifest.isDev && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">dev</span>}
            </div>
            {manifest.description && (
              <p className="mt-0.5 text-sm text-muted-foreground">{manifest.description}</p>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {manifest.version && <span>v{manifest.version}</span>}
              {manifest.author && <span>{t('resources.apps.authorBy', { name: manifest.author.name })}</span>}
            </div>
            {manifest.author?.url && (
              <a href={manifest.author.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 text-xs text-primary hover:underline">
                <Link className="size-3 shrink-0" />
                <span className="truncate">{manifest.author.url}</span>
              </a>
            )}
          </div>
        </div>

        <div className="space-y-5">
          {/* Tools section */}
          <div>
            <SettingsSection title={t('resources.apps.preapprovalTitle')}>
              {tools.length > 0 ? (
                loading ? (
                  <p className={cn(settingsRowClassName, 'text-xs text-muted-foreground')}>{t('resources.apps.loading')}</p>
                ) : (
                  tools.map((tool) => {
                    const isPreapproved = preapproved.includes(tool.name)
                    return (
                      <SettingsRow
                        key={tool.name}
                        label={<span className="font-mono">{tool.name}</span>}
                        description={tool.description}
                      >
                        <Switch
                          checked={isPreapproved}
                          onCheckedChange={(checked) => toggleTool(tool.name, checked)}
                        />
                      </SettingsRow>
                    )
                  })
                )
              ) : (
                <p className={cn(settingsRowClassName, 'text-xs text-muted-foreground')}>{t('resources.apps.noAppTools')}</p>
              )}
            </SettingsSection>
            <SettingsFootnote>{t('resources.apps.preapprovalDescription')}</SettingsFootnote>
          </div>

          {/* Permissions section */}
          {hasPermissions && (
            <SettingsSection title={t('resources.apps.permissions')}>
              <PermissionRow
                icon={<Terminal className="size-5 shrink-0 text-warning" />}
                label="Trusted MiniApp Host"
                reason="Full local Node.js access to files, network, and processes."
              />
              {manifest.permissions?.network?.map((entry) => (
                <PermissionRow
                  key={`net-${entry.domain}`}
                  icon={<Globe className="size-5 shrink-0 text-muted-foreground" />}
                  label={<span className="font-mono">{entry.domain}</span>}
                  reason={entry.reason}
                />
              ))}
              {manifest.permissions?.media?.map((entry) => {
                const Icon = entry.kind === 'microphone' ? Mic : Video
                const label = entry.kind === 'microphone' ? 'Microphone' : 'Camera'
                return (
                  <PermissionRow
                    key={`media-${entry.kind}`}
                    icon={<Icon className="size-5 shrink-0 text-destructive" />}
                    label={(
                      <span className="flex items-center gap-1.5">
                        {label}
                        <span className="inline-flex h-4 shrink-0 items-center rounded bg-destructive/10 px-1 text-[10px] leading-none text-destructive">Live</span>
                      </span>
                    )}
                    reason={entry.reason}
                  />
                )
              })}
            </SettingsSection>
          )}

          {/* Uninstall */}
          <SettingsSection title={t('resources.apps.uninstallTitle')}>
            <SettingsRow
              label={t('resources.apps.uninstall')}
              description={manifest.isDev
                ? t('resources.apps.uninstallDevDescription')
                : t('resources.apps.uninstallDescription')}
            >
              {confirmDelete ? (
                <>
                  <span className="text-xs text-muted-foreground">{t('resources.apps.confirmQuestion')}</span>
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</Button>
                  <Button size="sm" variant="destructive" className="h-7" onClick={handleUninstall}>
                    <Trash2 className="size-3.5" />
                    {t('resources.apps.confirm')}
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" className="h-7 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="size-3.5" />
                  {t('resources.apps.uninstall')}
                </Button>
              )}
            </SettingsRow>
          </SettingsSection>
        </div>
      </div>
    </div>
  )
}

export function AppsSettingsPage() {
  const { t } = useTranslation()
  const apps = useMiniAppStore((s) => s.apps)
  const loaded = useMiniAppStore((s) => s.loaded)
  const refreshApps = useMiniAppStore((s) => s.refreshApps)
  const currentFolder = useAppStore((s) => s.currentFolder)
  const [selectedApp, setSelectedApp] = useState<MiniAppEntry | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)

  useEffect(() => {
    refreshApps(currentFolder ?? undefined)
  }, [refreshApps, currentFolder])

  if (selectedApp) {
    const current = apps.find((a) => a.id === selectedApp.id)
    if (current) {
      return <AppDetailPage app={current} onBack={() => setSelectedApp(null)} />
    }
    setSelectedApp(null)
  }

  const personalApps = apps.filter((a) => !currentFolder || !a.installDir.startsWith(currentFolder))
  const projectApps = apps.filter((a) => currentFolder && a.installDir.startsWith(currentFolder))

  return (
    <SettingsPage
      title={t('resources.apps.title')}
      actions={(
        <>
          <Button
            variant={libraryOpen ? 'default' : 'outline'}
            size="sm"
            className="h-7"
            onClick={() => setLibraryOpen((v) => !v)}
          >
            <Library className="size-3.5" />
            {t('resources.devAppLibrary.toggleButton')}
          </Button>
          <ProjectSelector triggerClassName={cn(settingsSelectTriggerClassName, 'gap-2 py-0')} />
        </>
      )}
    >
      {libraryOpen && <DevAppLibraryView onClose={() => setLibraryOpen(false)} />}

      {!loaded ? (
        <SettingsCard>
          <p className={cn(settingsRowClassName, 'text-xs text-muted-foreground')}>{t('resources.apps.loading')}</p>
        </SettingsCard>
      ) : apps.length === 0 ? (
        <SettingsCard className="px-6 py-8 text-center">
          <p className="text-sm text-muted-foreground">{t('resources.apps.empty')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('resources.apps.emptyHint')}</p>
        </SettingsCard>
      ) : (
        <>
          <AppSection title={t('resources.apps.sections.personal')} apps={personalApps} onSelect={setSelectedApp} />
          <AppSection title={t('resources.apps.sections.project')} apps={projectApps} onSelect={setSelectedApp} />
        </>
      )}
    </SettingsPage>
  )
}
