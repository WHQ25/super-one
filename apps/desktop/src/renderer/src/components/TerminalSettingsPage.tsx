import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Trash2 } from 'lucide-react'
import type { TerminalCommandRule } from '@superone/shared/terminal-command-rules'
import { displayHostPath, parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { Badge } from '@superone/ui/components/ui/badge'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { useAppStore } from '@/stores/app'
import { projectDisplayName } from '@/lib/project-display-name'
import { SettingsPage, SettingsRow, SettingsSection, SettingsSubheader, settingsRowClassName } from '@/components/settings/SettingsSection'
import { SettingsFootnote } from '@/components/settings/SettingsFootnote'

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
    <SettingsPage title={t('settings.terminal.title')}>
      <div>
        <SettingsSection title={t('settings.terminal.rules.title')}>
          {state.status === 'loading' && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {state.status === 'error' && (
            <SettingsRow label={<span className="text-xs text-destructive">{t('settings.terminal.rules.error')}</span>}>
              <Button variant="outline" size="sm" className="h-7" onClick={() => { setState({ status: 'loading' }); void load() }}>
                {t('settings.terminal.rules.retry')}
              </Button>
            </SettingsRow>
          )}
          {state.status === 'ready' && groups.length === 0 && (
            <p className={cn(settingsRowClassName, 'text-xs text-muted-foreground')}>
              {t('settings.terminal.rules.empty')}
            </p>
          )}
          {groups.map((group) => (
            <Fragment key={group.projectKey}>
              <SettingsSubheader className="flex min-w-0 items-center gap-2">
                <span className="max-w-[60%] shrink-0 truncate text-foreground">{group.name}</span>
                {group.remote && (
                  <Badge variant="outline" className="h-4 px-1 text-[10px]">{t('settings.terminal.rules.remoteBadge')}</Badge>
                )}
                <span className="min-w-0 truncate font-mono font-normal" title={group.path}>{group.path}</span>
              </SettingsSubheader>
              {group.rules.map((rule) => (
                <SettingsRow
                  key={rule.pattern}
                  label={<span className="block truncate font-mono text-xs" title={rule.pattern}>{rule.pattern}</span>}
                >
                  <IconButton
                    size="xs"
                    variant="ghost"
                    tooltip={t('settings.terminal.rules.remove')}
                    onClick={() => void remove(rule)}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </SettingsRow>
              ))}
            </Fragment>
          ))}
        </SettingsSection>
        <SettingsFootnote>{t('settings.terminal.rules.description')}</SettingsFootnote>
      </div>
    </SettingsPage>
  )
}
