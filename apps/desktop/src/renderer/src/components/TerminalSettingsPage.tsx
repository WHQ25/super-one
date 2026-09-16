import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Trash2 } from 'lucide-react'
import type { TerminalCommandRule } from '@superone/shared/terminal-command-rules'
import { displayHostPath, parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { Badge } from '@superone/ui/components/ui/badge'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { useAppStore } from '@/stores/app'
import { projectDisplayName } from '@/lib/project-display-name'

type Rules =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; rules: TerminalCommandRule[] }

/**
 * The revoke surface for "Always allow in this project" terminal commands
 * (docs/design/terminal-agent-tools.md §5). Rules live in SuperOne's own DB,
 * not in any harness settings file, so this page is the only place a person
 * can see or drop them. Grouped by project because the same pattern may be
 * allowed in one project and not another.
 */
export function TerminalSettingsPage() {
  const { t } = useTranslation()
  const recentFolders = useAppStore((s) => s.recentFolders)
  const [state, setState] = useState<Rules>({ status: 'loading' })

  const load = useCallback(async () => {
    try {
      const rules = await window.terminal.listCommandRules()
      setState({ status: 'ready', rules })
    } catch {
      setState({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    let mounted = true
    void load().then(() => { if (!mounted) setState({ status: 'loading' }) })
    return () => { mounted = false }
  }, [load])

  async function remove(rule: TerminalCommandRule) {
    await window.terminal.removeCommandRule(rule.projectKey, rule.pattern)
    // Re-read rather than filter locally so the list reflects what the DB
    // actually holds (a second window may have removed rules meanwhile).
    await load()
  }

  const groups = useMemo(() => {
    if (state.status !== 'ready') return []
    const byProject = new Map<string, TerminalCommandRule[]>()
    for (const rule of state.rules) {
      const list = byProject.get(rule.projectKey) ?? []
      list.push(rule)
      byProject.set(rule.projectKey, list)
    }
    return [...byProject.entries()].map(([projectKey, rules]) => ({
      projectKey,
      name: projectDisplayName(recentFolders, projectKey),
      path: displayHostPath(projectKey),
      remote: parseRemoteProjectKey(projectKey) !== null,
      rules,
    }))
  }, [state, recentFolders])

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">{t('settings.terminal.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('settings.terminal.subtitle')}</p>
      </div>

      <div className="rounded-lg border border-border">
        <div className="p-4">
          <p className="text-sm font-medium">{t('settings.terminal.rules.title')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.terminal.rules.description')}</p>
        </div>
        {state.status === 'loading' && (
          <div className="flex items-center justify-center border-t border-border p-6">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {state.status === 'error' && (
          <div className="flex items-center justify-between gap-3 border-t border-border p-4">
            <p className="text-xs text-destructive">{t('settings.terminal.rules.error')}</p>
            <Button variant="outline" size="sm" onClick={() => { setState({ status: 'loading' }); void load() }}>
              {t('settings.terminal.rules.retry')}
            </Button>
          </div>
        )}
        {state.status === 'ready' && groups.length === 0 && (
          <p className="border-t border-border p-4 text-xs text-muted-foreground">
            {t('settings.terminal.rules.empty')}
          </p>
        )}
        {groups.map((group) => (
          <div key={group.projectKey} className="border-t border-border p-4">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium">{group.name}</p>
              {group.remote && <Badge variant="outline">{t('settings.terminal.rules.remoteBadge')}</Badge>}
            </div>
            <p className="truncate font-mono text-xs text-muted-foreground" title={group.path}>{group.path}</p>
            <div className="mt-2 divide-y divide-border">
              {group.rules.map((rule) => (
                <div key={rule.pattern} className="flex items-center justify-between gap-3 py-2">
                  <p className="min-w-0 truncate font-mono text-xs" title={rule.pattern}>{rule.pattern}</p>
                  <IconButton
                    size="xs"
                    variant="ghost"
                    tooltip={t('settings.terminal.rules.remove')}
                    onClick={() => void remove(rule)}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
