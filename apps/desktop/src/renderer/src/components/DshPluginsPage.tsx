import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  FolderOpen,
  Loader2,
  Package,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Input } from '@superone/ui/components/ui/input'
import { Switch } from '@superone/ui/components/ui/switch'
import { Badge } from '@superone/ui/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import type {
  DshBundledPluginInfo,
  DshPluginInfo,
  DshPluginInstallSource,
  DshPluginList,
} from '@superone/shared/agent-types'

/**
 * Inspect bundled official dsh plugins and manage third-party plugins.
 *
 * The trust notice is not decoration: a dsh plugin runs in the main process with
 * full Node privileges, which is the opposite of the mini-app sandbox users may
 * expect from "plugin". Installing one is closer to installing an editor
 * extension, and the page says so before it offers an install control.
 */
export function DshPluginsPage() {
  const { t } = useTranslation()
  const [list, setList] = useState<DshPluginList | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [npmName, setNpmName] = useState('')
  const [view, setView] = useState<'bundled' | 'thirdParty'>('bundled')

  const refresh = useCallback(async () => {
    try {
      setList(await window.app.dshListPlugins())
      setError(null)
    } catch (cause) {
      setError(String(cause))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const install = useCallback(
    async (source: DshPluginInstallSource, label: string) => {
      setBusy(label)
      setError(null)
      setNotice(null)
      try {
        const result = await window.app.dshInstallPlugin(source)
        const warnings: string[] = []
        if (result.unmetDependencies.length > 0) {
          warnings.push(
            t('settings.dshPlugins.unmetDeps', {
              deps: result.unmetDependencies.join(', '),
            }),
          )
        }
        setNotice(
          [
            t('settings.dshPlugins.installed', {
              name: result.name,
              version: result.version,
            }),
            ...warnings,
          ].join(' '),
        )
        await refresh()
      } catch (cause) {
        setError(String(cause))
      } finally {
        setBusy(null)
      }
    },
    [refresh, t],
  )

  const installFromFolder = useCallback(async () => {
    const path = await window.app.selectFolder()
    if (!path) return
    await install({ kind: 'directory', path }, 'folder')
  }, [install])

  const installFromNpm = useCallback(async () => {
    const name = npmName.trim()
    if (!name) return
    await install({ kind: 'npm', name }, 'npm')
    setNpmName('')
  }, [install, npmName])

  const toggle = useCallback(
    async (plugin: DshPluginInfo) => {
      setBusy(plugin.id)
      try {
        await window.app.dshSetPluginDisabled(plugin.id, !plugin.disabled)
        await refresh()
      } catch (cause) {
        setError(String(cause))
      } finally {
        setBusy(null)
      }
    },
    [refresh],
  )

  const uninstall = useCallback(
    async (plugin: DshPluginInfo) => {
      setBusy(plugin.id)
      try {
        await window.app.dshUninstallPlugin(plugin.id)
        await refresh()
      } catch (cause) {
        setError(String(cause))
      } finally {
        setBusy(null)
      }
    },
    [refresh],
  )

  return (
    <div className="flex flex-col gap-4 p-1">
      <Tabs
        value={view}
        onValueChange={(value) => setView(value as typeof view)}
      >
        <TabsList className="h-auto min-h-10 w-auto p-1">
          <TabsTrigger value="bundled" className="gap-2 px-3 py-2 text-xs">
            {t('settings.dshPlugins.bundledTitle')}
            <span className="tabular-nums text-muted-foreground">
              {(list?.bundled ?? []).length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="thirdParty" className="gap-2 px-3 py-2 text-xs">
            {t('settings.dshPlugins.thirdPartyTitle')}
            <span className="tabular-nums text-muted-foreground">
              {list?.plugins.length ?? 0}
            </span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {view === 'bundled' ? (
        list ? (
          <BundledPlugins plugins={list.bundled ?? []} />
        ) : null
      ) : (
        <section className="flex flex-col gap-3">
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-warning-foreground">
              <AlertTriangle className="size-4" />
              {t('settings.dshPlugins.trustTitle')}
            </div>
            <p className="mt-1 text-muted-foreground">
              {t('settings.dshPlugins.trustBody')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="min-w-56 flex-1"
              value={npmName}
              onChange={(event) => setNpmName(event.target.value)}
              placeholder={t('settings.dshPlugins.npmPlaceholder')}
              onKeyDown={(event) => {
                // IME guard: Enter while composing is a candidate pick, not submit.
                if (event.key === 'Enter' && !event.nativeEvent.isComposing)
                  void installFromNpm()
              }}
            />
            <Button
              onClick={() => void installFromNpm()}
              disabled={busy !== null || !npmName.trim()}
            >
              {busy === 'npm' ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Package data-icon="inline-start" />
              )}
              {t('settings.dshPlugins.installFromNpm')}
            </Button>
            <Button
              variant="outline"
              onClick={() => void installFromFolder()}
              disabled={busy !== null}
            >
              {busy === 'folder' ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <FolderOpen data-icon="inline-start" />
              )}
              {t('settings.dshPlugins.installFromFolder')}
            </Button>
            <IconButton
              size="lg"
              onClick={() => void refresh()}
              disabled={busy !== null}
              aria-label={t('settings.dshPlugins.refresh')}
              tooltip={t('settings.dshPlugins.refresh')}
            >
              <RefreshCw />
            </IconButton>
          </div>
          {notice ? (
            <p className="text-xs text-muted-foreground">{notice}</p>
          ) : null}
          {error ? <p className="text-xs text-error">{error}</p> : null}
          {list?.problem ? (
            <p className="text-xs text-error">{list.problem}</p>
          ) : null}

          {list && list.plugins.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('settings.dshPlugins.empty')}
            </p>
          ) : null}

          {list && list.plugins.length > 0 ? (
            <div
              role="list"
              aria-label={t('settings.dshPlugins.thirdPartyTitle')}
              className="grid grid-cols-2 gap-3 xl:grid-cols-3"
            >
              {list.plugins.map((plugin) => (
                <div
                  key={plugin.id}
                  role="listitem"
                  className="flex min-h-32 min-w-0 flex-col rounded-lg border bg-card p-3"
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p
                        className="break-all text-sm font-medium leading-snug"
                        title={plugin.name}
                      >
                        {plugin.name}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {plugin.version}
                      </p>
                    </div>
                    <StatusBadge plugin={plugin} />
                  </div>
                  {plugin.reason ? (
                    <p
                      className="mt-2 line-clamp-2 text-xs text-muted-foreground"
                      title={plugin.reason}
                    >
                      {plugin.reason}
                    </p>
                  ) : null}
                  <div className="mt-auto flex items-center justify-end gap-2 pt-3">
                    <Switch
                      checked={!plugin.disabled}
                      onCheckedChange={() => void toggle(plugin)}
                      disabled={busy !== null}
                      aria-label={plugin.name}
                    />
                    <IconButton
                      variant="destructive"
                      size="lg"
                      onClick={() => void uninstall(plugin)}
                      disabled={busy !== null}
                      aria-label={`${t('settings.dshPlugins.uninstall')} ${plugin.name}`}
                      tooltip={t('settings.dshPlugins.uninstall')}
                    >
                      <Trash2 />
                    </IconButton>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {list ? (
            <p
              className="truncate text-xs text-muted-foreground"
              title={list.root}
            >
              {t('settings.dshPlugins.rootPath', { path: list.root })}
            </p>
          ) : null}
        </section>
      )}
    </div>
  )
}

function BundledPlugins({ plugins }: { plugins: DshBundledPluginInfo[] }) {
  const { t } = useTranslation()

  return (
    <section className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {t('settings.dshPlugins.bundledDescription')}
      </p>
      <div
        role="list"
        aria-label={t('settings.dshPlugins.bundledTitle')}
        className="grid grid-cols-2 gap-3 xl:grid-cols-3"
      >
        {plugins.map((plugin) => (
          <div
            key={plugin.name}
            role="listitem"
            className="flex min-h-28 min-w-0 flex-col rounded-lg border bg-card p-3"
          >
            <div className="min-w-0">
              <p
                className="break-all font-mono text-xs font-medium leading-relaxed"
                title={plugin.name}
              >
                {plugin.name}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {plugin.version}
              </p>
            </div>
            <div className="mt-auto flex flex-wrap gap-1 pt-3">
              {plugin.scopes.map((scope) => (
                <Badge key={scope} variant="outline">
                  {scopeLabel(scope, t)}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function scopeLabel(
  scope: string,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  switch (scope) {
    case 'core':
      return t('settings.dshPlugins.scope.core')
    case 'standard':
      return t('settings.dshPlugins.scope.standard')
    case 'code':
      return t('settings.dshPlugins.scope.code')
    case 'minimal':
      return t('settings.dshPlugins.scope.minimal')
    case 'cordis':
      return t('settings.dshPlugins.scope.cordis')
    default:
      return scope
  }
}

/**
 * The live state of one row.
 *
 * `status === null` means no dsh runtime is up, which is genuinely unknown
 * rather than broken — rendering it as a failure would tell users their plugin
 * is wrong when they simply have no dsh session open.
 */
function StatusBadge({ plugin }: { plugin: DshPluginInfo }) {
  const { t } = useTranslation()
  if (plugin.disabled)
    return (
      <Badge variant="outline">
        {t('settings.dshPlugins.status.disabled')}
      </Badge>
    )
  if (plugin.status === null) return null
  if (plugin.status === 'mounted') {
    return (
      <Badge variant="outline" className="text-success">
        {t('settings.dshPlugins.status.mounted')}
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-error">
      {t(`settings.dshPlugins.status.${plugin.status}`)}
    </Badge>
  )
}
