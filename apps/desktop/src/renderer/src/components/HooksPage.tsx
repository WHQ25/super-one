import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Pencil, Trash2, Terminal, MessageSquare, Bot, Globe, Server } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import {
  ResourceScopeToolbar,
  type ResourceScopeView,
} from '@/components/settings/ResourceScopeToolbar'
import { SettingsSection, settingsRowClassName } from '@/components/settings/SettingsSection'
import { SettingsCollapsibleGroup } from '@/components/settings/SettingsDisclosureRow'
import { SettingsEmptyState } from '@/components/settings/SettingsEmptyState'
import { SettingsFootnote } from '@/components/settings/SettingsFootnote'
import { HookEditorDialog } from './HookEditorDialog'
import { CodexHooksPanel } from './CodexHooksPanel'
import { cn } from '@superone/ui/lib/utils'
import { scopeBadgeClass } from '@/lib/scope-badge'
import type { HookConfig, HookEntry, HookEntryType, HookEventName, HookScope } from '@superone/shared/agent-types'

const PRIMARY_EVENTS: HookEventName[] = [
  'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop',
  'SubagentStop', 'SessionStart', 'SessionEnd', 'Notification',
]

const TYPE_ICON: Record<HookEntryType, typeof Terminal> = {
  command: Terminal,
  prompt: MessageSquare,
  agent: Bot,
  http: Globe,
  mcp_tool: Server,
}

const SCOPE_LABEL: Record<HookScope, string> = {
  user: 'resources.hooks.scope.user',
  project: 'resources.hooks.scope.project',
  local: 'resources.hooks.scope.local',
}

function summaryFor(entry: HookEntry): string {
  switch (entry.type) {
    case 'command': return entry.command.split('\n')[0].slice(0, 80)
    case 'prompt': return entry.prompt.split('\n')[0].slice(0, 80)
    case 'agent': return entry.prompt.split('\n')[0].slice(0, 80)
    case 'http': return entry.url
    case 'mcp_tool': return `${entry.server}.${entry.tool}`
  }
}

function compareEvents(a: HookEventName, b: HookEventName): number {
  const aIdx = PRIMARY_EVENTS.indexOf(a)
  const bIdx = PRIMARY_EVENTS.indexOf(b)
  if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx
  if (aIdx !== -1) return -1
  if (bIdx !== -1) return 1
  return a.localeCompare(b)
}

export function HooksPage() {
  const settingsProvider = useAppStore((s) => s.settingsProvider)
  if (settingsProvider === 'codex') {
    return <CodexHooksPanel />
  }
  return <ClaudeHooksPage />
}

function ClaudeHooksPage() {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const { hooks, fetchHooks, saveHook, deleteHook } = useSettingsStore()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<HookConfig | undefined>(undefined)
  const [confirmDelete, setConfirmDelete] = useState<HookConfig | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [scope, setScope] = useState<ResourceScopeView>('user')

  useEffect(() => { fetchHooks() }, [currentFolder, fetchHooks])

  // User view includes local hooks (project-local but not shared project scope).
  const scopedHooks = useMemo(
    () =>
      hooks.filter((h) =>
        scope === 'user' ? h.scope === 'user' || h.scope === 'local' : h.scope === 'project',
      ),
    [hooks, scope],
  )

  const grouped = useMemo(() => {
    const map = new Map<HookEventName, HookConfig[]>()
    for (const h of scopedHooks) {
      const list = map.get(h.event) ?? []
      list.push(h)
      map.set(h.event, list)
    }
    const sorted = Array.from(map.entries()).sort(([a], [b]) => compareEvents(a, b))
    return sorted
  }, [scopedHooks])

  const handleAdd = () => {
    setEditing(undefined)
    setEditorOpen(true)
  }

  const handleEdit = (config: HookConfig) => {
    setEditing(config)
    setEditorOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return
    await deleteHook(confirmDelete.id)
    setConfirmDelete(null)
  }

  const toggleCollapse = (event: HookEventName) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(event)) next.delete(event)
      else next.add(event)
      return next
    })
  }

  return (
    <div>
      <SettingsSection
        title={t('resources.hooks.title')}
        actions={
          <ResourceScopeToolbar
            className="mb-0"
            scope={scope}
            onScopeChange={setScope}
            actions={
              <Button size="sm" variant="outline" className="h-7" onClick={handleAdd}>
                <Plus className="size-3.5" />
                {t('resources.hooks.add')}
              </Button>
            }
          />
        }
      >
        {scopedHooks.length === 0 ? (
          <SettingsEmptyState
            title={t('resources.hooks.empty')}
            hint={t('resources.hooks.emptyHint')}
            action={
              <Button size="sm" className="h-7" onClick={handleAdd}>
                <Plus className="size-3.5" />
                {t('resources.hooks.add')}
              </Button>
            }
          />
        ) : (
          grouped.map(([event, entries]) => (
            <SettingsCollapsibleGroup
              key={event}
              title={event}
              meta={t('resources.hooks.entryCount', { count: entries.length })}
              collapsed={collapsed.has(event)}
              onToggle={() => toggleCollapse(event)}
            >
              {entries.map((cfg) => (
                <HookRow
                  key={cfg.id}
                  cfg={cfg}
                  onEdit={() => handleEdit(cfg)}
                  onDelete={() => setConfirmDelete(cfg)}
                />
              ))}
            </SettingsCollapsibleGroup>
          ))
        )}
      </SettingsSection>
      <SettingsFootnote>{t('resources.hooks.applyNote')}</SettingsFootnote>

      <HookEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        initial={editing}
        onSubmit={async (payload, replaceId) => { await saveHook(payload, replaceId) }}
      />

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent showCloseButton={false} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('resources.hooks.deleteTitle')}</DialogTitle>
            <DialogDescription>{t('resources.hooks.deleteDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>{t('common.delete')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function HookRow({ cfg, onEdit, onDelete }: { cfg: HookConfig; onEdit: () => void; onDelete: () => void }) {
  const { t } = useTranslation()
  const TypeIcon = TYPE_ICON[cfg.entry.type]
  return (
    <div className={cn(settingsRowClassName, 'group flex items-center gap-3')}>
      <span className={cn(
        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
        cfg.scope === 'user' && scopeBadgeClass('user'),
        cfg.scope === 'project' && scopeBadgeClass('project'),
        cfg.scope === 'local' && scopeBadgeClass('minor'),
      )}>
        {t(SCOPE_LABEL[cfg.scope])}
      </span>
      {cfg.matcher && (
        <span className="shrink-0 rounded bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {cfg.matcher}
        </span>
      )}
      <TypeIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate font-mono text-xs text-foreground/80">
        {summaryFor(cfg.entry)}
      </span>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          onClick={onEdit}
          className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
          aria-label="edit"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label="delete"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
