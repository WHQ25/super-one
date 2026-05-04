import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2, Webhook, Terminal, MessageSquare, Bot, Globe, Server } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { Button } from '@/components/ui/button'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { HookEditorDialog } from './HookEditorDialog'
import { cn } from '@/lib/utils'
import type { HookConfig, HookEntry, HookEntryType, HookEventName, HookScope } from '../../../shared/agent-types'

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
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const { hooks, fetchHooks, saveHook, deleteHook } = useSettingsStore()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<HookConfig | undefined>(undefined)
  const [confirmDelete, setConfirmDelete] = useState<HookConfig | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => { fetchHooks() }, [currentFolder, fetchHooks])

  const grouped = useMemo(() => {
    const map = new Map<HookEventName, HookConfig[]>()
    for (const h of hooks) {
      const list = map.get(h.event) ?? []
      list.push(h)
      map.set(h.event, list)
    }
    const sorted = Array.from(map.entries()).sort(([a], [b]) => compareEvents(a, b))
    return sorted
  }, [hooks])

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
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('resources.hooks.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('resources.hooks.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <ProjectSelector mode="switch" />
          <Button size="sm" onClick={handleAdd}>
            <Plus className="size-4" />
            {t('resources.hooks.add')}
          </Button>
        </div>
      </div>

      <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
        {t('resources.hooks.applyNote')}
      </div>

      {hooks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <Webhook className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">{t('resources.hooks.empty')}</p>
          <p className="mt-1 text-xs text-muted-foreground/70">{t('resources.hooks.emptyHint')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map(([event, entries]) => {
            const isCollapsed = collapsed.has(event)
            return (
              <div key={event} className="overflow-hidden rounded-lg border border-border bg-card">
                <button
                  onClick={() => toggleCollapse(event)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center gap-1.5">
                    {isCollapsed ? <ChevronRight className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                    <span className="text-sm font-medium">{event}</span>
                    <span className="text-xs text-muted-foreground">
                      {t('resources.hooks.entryCount', { count: entries.length })}
                    </span>
                  </div>
                </button>
                <AnimatePresence initial={false}>
                  {!isCollapsed && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: 'auto' }}
                      exit={{ height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden border-t border-border"
                    >
                      <div className="divide-y divide-border">
                        {entries.map((cfg) => (
                          <HookRow
                            key={cfg.id}
                            cfg={cfg}
                            onEdit={() => handleEdit(cfg)}
                            onDelete={() => setConfirmDelete(cfg)}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </div>
      )}

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
    <div className="group flex items-center gap-3 px-3 py-2.5">
      <span className={cn(
        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
        cfg.scope === 'user' && 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
        cfg.scope === 'project' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        cfg.scope === 'local' && 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      )}>
        {t(SCOPE_LABEL[cfg.scope])}
      </span>
      {cfg.matcher && (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {cfg.matcher}
        </span>
      )}
      <TypeIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate font-mono text-xs text-foreground/80">
        {summaryFor(cfg.entry)}
      </span>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={onEdit}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
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
