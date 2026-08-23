import { cn } from '@superone/ui/lib/utils'
import { useTranslation } from 'react-i18next'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { X, FolderPlus, Folder } from 'lucide-react'

interface DirManagerPanelProps {
  isCoding: boolean
}

type DirScope = 'project' | 'session'

interface DirSectionProps {
  label: string
  hint: string
  dirs: string[]
  scope: DirScope
  onAdd: (dir: string, scope: DirScope) => void
  onRemove: (dir: string, scope: DirScope) => void
}

function DirSection({ label, hint, dirs, scope, onAdd, onRemove }: DirSectionProps) {
  const { t } = useTranslation()
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground/60">{hint}</span>
        <button
          onMouseDown={async (e) => {
            e.preventDefault()
            const folder = await window.app.selectFolder()
            if (folder) onAdd(folder, scope)
          }}
          className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <FolderPlus className="size-3.5" />
        </button>
      </div>
      {dirs.length === 0 ? (
        <div className="text-xs text-muted-foreground/60 italic">{t('chat.dirManager.empty')}</div>
      ) : (
        <div className="space-y-0.5">
          {dirs.map((dir) => (
            <div key={dir} className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/50">
              <span className="flex min-w-0 items-center gap-1.5">
                <Folder className="size-3.5 shrink-0 text-blue-500" />
                <span className="truncate text-foreground">{dir}</span>
              </span>
              <button
                onMouseDown={(e) => { e.preventDefault(); onRemove(dir, scope) }}
                className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * `/add-dir` surface. Two scopes, both owned by SuperOne: project folders
 * persist on the project record and reach every harness that supports extra
 * roots; session folders last for this session only.
 *
 * Nothing here reads or writes a harness config file — a folder added while on
 * Claude is the same folder Codex and ACP see.
 */
export function DirManagerPanel({ isCoding }: DirManagerPanelProps) {
  const { t } = useTranslation()
  const setShowDirManager = useChatStore((s) => s.setShowDirManager)
  const sessionDirs = useActiveSession((s) => s.additionalDirs)
  const projectDirs = useActiveSession((s) => s.projectExtraDirs)
  const addDir = useChatStore((s) => s.addDir)
  const removeDir = useChatStore((s) => s.removeDir)

  return (
    <div className={cn(
      'absolute bottom-full left-0 right-0 z-10 flex max-h-80 flex-col overflow-hidden border border-border bg-popover',
      isCoding ? 'mb-1 rounded-xl' : 'mb-0.5 rounded-t-lg'
    )}>
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">/add-dir</span>
        <button
          onMouseDown={(e) => { e.preventDefault(); setShowDirManager(false) }}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border px-3 py-2 space-y-3">
        <DirSection
          label={t('chat.dirManager.project')}
          hint={t('chat.dirManager.projectHint')}
          dirs={projectDirs}
          scope="project"
          onAdd={addDir}
          onRemove={removeDir}
        />
        <DirSection
          label={t('chat.dirManager.session')}
          hint={t('chat.dirManager.sessionHint')}
          dirs={sessionDirs}
          scope="session"
          onAdd={addDir}
          onRemove={removeDir}
        />
      </div>
    </div>
  )
}
