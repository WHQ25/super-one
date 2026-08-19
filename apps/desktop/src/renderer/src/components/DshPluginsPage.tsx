import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, FolderOpen, Loader2, Package, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { Input } from '@superone/ui/components/ui/input'
import { Switch } from '@superone/ui/components/ui/switch'
import { Badge } from '@superone/ui/components/ui/badge'
import type { DshPluginInfo, DshPluginInstallSource, DshPluginList } from '@superone/shared/agent-types'

/**
 * Manage third-party dsh plugins.
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
            t('settings.dshPlugins.unmetDeps', { deps: result.unmetDependencies.join(', ') }),
          )
        }
        setNotice(
          [t('settings.dshPlugins.installed', { name: result.name, version: result.version }), ...warnings]
            .join(' '),
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
      <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
        <div className="flex items-center gap-2 font-medium text-warning-foreground">
          <AlertTriangle className="size-4" />
          {t('settings.dshPlugins.trustTitle')}
        </div>
        <p className="mt-1 text-muted-foreground">{t('settings.dshPlugins.trustBody')}</p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Input
            value={npmName}
            onChange={(event) => setNpmName(event.target.value)}
            placeholder={t('settings.dshPlugins.npmPlaceholder')}
            onKeyDown={(event) => {
              // IME guard: Enter while composing is a candidate pick, not submit.
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) void installFromNpm()
            }}
          />
          <Button onClick={() => void installFromNpm()} disabled={busy !== null || !npmName.trim()}>
            {busy === 'npm' ? <Loader2 className="size-4 animate-spin" /> : <Package className="size-4" />}
            {t('settings.dshPlugins.installFromNpm')}
          </Button>
          <Button variant="outline" onClick={() => void installFromFolder()} disabled={busy !== null}>
            {busy === 'folder' ? <Loader2 className="size-4 animate-spin" /> : <FolderOpen className="size-4" />}
            {t('settings.dshPlugins.installFromFolder')}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => void refresh()} disabled={busy !== null}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
        {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
        {error ? <p className="text-xs text-error">{error}</p> : null}
        {list?.problem ? <p className="text-xs text-error">{list.problem}</p> : null}
      </div>

      {list && list.plugins.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t('settings.dshPlugins.empty')}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {list?.plugins.map((plugin) => (
          <div key={plugin.id} className="flex items-center gap-3 rounded-md border p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{plugin.name}</span>
                <span className="text-xs text-muted-foreground">{plugin.version}</span>
                <StatusBadge plugin={plugin} />
              </div>
              {plugin.reason ? (
                <p className="mt-1 truncate text-xs text-muted-foreground">{plugin.reason}</p>
              ) : null}
            </div>
            <Switch
              checked={!plugin.disabled}
              onCheckedChange={() => void toggle(plugin)}
              disabled={busy !== null}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void uninstall(plugin)}
              disabled={busy !== null}
              aria-label={t('settings.dshPlugins.uninstall')}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      {list ? (
        <p className="truncate text-xs text-muted-foreground" title={list.root}>
          {t('settings.dshPlugins.rootPath', { path: list.root })}
        </p>
      ) : null}
    </div>
  )
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
  if (plugin.disabled) return <Badge variant="outline">{t('settings.dshPlugins.status.disabled')}</Badge>
  if (plugin.status === null) return null
  if (plugin.status === 'mounted') {
    return <Badge variant="outline" className="text-success">{t('settings.dshPlugins.status.mounted')}</Badge>
  }
  return <Badge variant="outline" className="text-error">{t(`settings.dshPlugins.status.${plugin.status}`)}</Badge>
}
