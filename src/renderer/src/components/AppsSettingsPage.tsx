import { useEffect, useState } from 'react'
import { ArrowLeft, ChevronRight, Link, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { useMiniAppStore } from '@/stores/miniapp'
import { useAppStore } from '@/stores/app'
import { cn } from '@/lib/utils'
import type { MiniAppEntry } from '../../../shared/miniapp-types'

function AppCard({ app, onClick }: { app: MiniAppEntry; onClick: () => void }) {
  const { t } = useTranslation()
  const tools = app.manifest.tools ?? []
  const toolCount = tools.length

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors cursor-pointer hover:bg-accent/50"
    >
      <MiniAppIcon appId={app.id} className="size-9 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium truncate">{app.manifest.name}</p>
          {app.manifest.isDev && <span className="text-[10px] px-1 rounded bg-orange-500/10 text-orange-600 dark:text-orange-400">dev</span>}
          {app.manifest.type && <span className="text-[10px] px-1 rounded bg-muted text-muted-foreground">{app.manifest.type}</span>}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {toolCount > 0 ? t('resources.apps.toolCount', { count: toolCount }) : t('resources.apps.noTools')}
          {app.manifest.version && ` · v${app.manifest.version}`}
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </div>
  )
}

function AppSection({ title, apps, onSelect }: { title: string; apps: MiniAppEntry[]; onSelect: (app: MiniAppEntry) => void }) {
  if (apps.length === 0) return null
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className="grid grid-cols-2 gap-3">
        {apps.map((app) => (
          <AppCard key={app.id} app={app} onClick={() => onSelect(app)} />
        ))}
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
      await uninstallApp(app.id)
      onBack()
      toast.success(t('resources.apps.uninstalled', { name: app.manifest.name }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('resources.apps.uninstallFailed'))
    }
  }

  const tools = app.manifest.tools ?? []
  const { manifest } = app
  const hasPermissions = (manifest.permissions?.fs?.length ?? 0) > 0 || (manifest.permissions?.network?.length ?? 0) > 0

  return (
    <div className="mx-auto max-w-2xl">
      <button
        onClick={onBack}
        className="mb-4 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-3" />
        {t('common.back')}
      </button>

      {/* App header */}
      <div className="mb-6 flex items-center gap-4">
        <MiniAppIcon appId={app.id} className="size-16 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold">{manifest.name}</h2>
            {manifest.isDev && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-600 dark:text-orange-400 font-medium">dev</span>}
            {manifest.type && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">{manifest.type}</span>}
          </div>
          {manifest.description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{manifest.description}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {manifest.version && <span>v{manifest.version}</span>}
            {manifest.author && <span>{t('resources.apps.authorBy', { name: manifest.author.name })}</span>}
          </div>
          {manifest.author?.url && (
            <a href={manifest.author.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-blue-500 hover:underline">
              <Link className="size-3 shrink-0" />
              <span className="truncate">{manifest.author.url}</span>
            </a>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {/* Tools section */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-1 text-sm font-medium">
            {t('resources.apps.preapprovalTitle')}
          </h3>
          <p className="mb-3 text-xs text-muted-foreground">
            {t('resources.apps.preapprovalDescription')}
          </p>
          {tools.length > 0 ? (
            loading ? (
              <div className="text-xs text-muted-foreground">{t('resources.apps.loading')}</div>
            ) : (
              <div className="space-y-2">
                {tools.map((tool) => {
                  const isPreapproved = preapproved.includes(tool.name)
                  return (
                    <div key={tool.name} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium font-mono">{tool.name}</p>
                        {tool.description && <p className="mt-0.5 text-xs text-muted-foreground">{tool.description}</p>}
                      </div>
                      <Switch
                        checked={isPreapproved}
                        onCheckedChange={(checked) => toggleTool(tool.name, checked)}
                      />
                    </div>
                  )
                })}
              </div>
            )
          ) : (
            <p className="text-sm text-muted-foreground">{t('resources.apps.noAppTools')}</p>
          )}
        </div>

        {/* Permissions section */}
        {hasPermissions && (
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-medium">{t('resources.apps.permissions')}</h3>
            <div className="space-y-2">
              {manifest.permissions?.fs?.map((entry, i) => (
                <div key={`fs-${i}`} className="rounded-md border border-border px-3 py-2">
                  <div className="flex items-center gap-1.5 text-sm">
                    <span className="font-medium">{entry.scope}</span>
                    {entry.path && <span className="text-muted-foreground font-mono text-xs">{entry.path}</span>}
                    <span className={cn('inline-flex h-4 shrink-0 items-center rounded px-1 text-[10px] leading-none', entry.access === 'read' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'bg-orange-500/10 text-orange-600 dark:text-orange-400')}>
                      {entry.scope === 'app' ? t('resources.apps.readWrite') : entry.access === 'read' ? t('resources.apps.readOnly') : t('resources.apps.readWrite')}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{entry.reason}</p>
                </div>
              ))}
              {manifest.permissions?.network?.map((entry) => (
                <div key={`net-${entry.domain}`} className="rounded-md border border-border px-3 py-2">
                  <div className="flex items-center gap-1.5 text-sm">
                    <span className="font-medium">{t('resources.apps.network')}</span>
                    <span className="text-muted-foreground font-mono text-xs">{entry.domain}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{entry.reason}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Uninstall */}
        {!manifest.isDev && (
          <div className="rounded-lg border border-destructive/30 bg-card p-4">
            <h3 className="mb-1 text-sm font-medium text-destructive">{t('resources.apps.uninstallTitle')}</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              {t('resources.apps.uninstallDescription')}
            </p>
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{t('resources.apps.confirmQuestion')}</span>
                <Button size="sm" variant="destructive" onClick={handleUninstall}>
                  <Trash2 className="mr-1 size-3" />
                  {t('resources.apps.confirm')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</Button>
              </div>
            ) : (
              <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="mr-1 size-3" />
                {t('resources.apps.uninstall')}
              </Button>
            )}
          </div>
        )}
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
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('resources.apps.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('resources.apps.subtitle')}</p>
        </div>
        <ProjectSelector mode="switch" />
      </div>

      {!loaded ? (
        <div className="text-sm text-muted-foreground">{t('resources.apps.loading')}</div>
      ) : apps.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">{t('resources.apps.empty')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('resources.apps.emptyHint')}</p>
        </div>
      ) : (
        <div className="space-y-6">
          <AppSection title={t('resources.apps.sections.personal')} apps={personalApps} onSelect={setSelectedApp} />
          <AppSection title={t('resources.apps.sections.project')} apps={projectApps} onSelect={setSelectedApp} />
        </div>
      )}
    </div>
  )
}
