import { cn } from '@superone/ui/lib/utils'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { X, FolderPlus, Folder } from 'lucide-react'

interface DirManagerPanelProps {
  isCoding: boolean
}

interface DirSectionProps {
  label: string
  dirs: string[]
  scope: 'project' | 'session'
  readOnly?: boolean
  removableSet?: Set<string>
  onAdd?: (dir: string, scope: 'project' | 'session') => void
  onRemove?: (dir: string, scope: 'project' | 'session') => void
}

function DirSection({ label, dirs, scope, readOnly, removableSet, onAdd, onRemove }: DirSectionProps) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        {!readOnly && onAdd && (
          <button
            onMouseDown={async (e) => {
              e.preventDefault()
              const folder = await window.app.selectFolder()
              if (folder) onAdd(folder, scope)
            }}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <FolderPlus className="size-3.5" />
          </button>
        )}
      </div>
      {dirs.length === 0 ? (
        <div className="text-xs text-muted-foreground/60 italic">No additional directories</div>
      ) : (
        <div className="space-y-0.5">
          {dirs.map((dir) => {
            const removable = !readOnly && (!removableSet || removableSet.has(dir))
            return (
              <div key={dir} className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/50">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Folder className="size-3.5 shrink-0 text-blue-500" />
                  <span className="truncate text-foreground">{dir}</span>
                </span>
                {removable && onRemove && (
                  <button
                    onMouseDown={(e) => { e.preventDefault(); onRemove(dir, scope) }}
                    className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="size-2.5" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function DirManagerPanel({ isCoding }: DirManagerPanelProps) {
  const setShowDirManager = useChatStore((s) => s.setShowDirManager)
  const additionalDirs = useActiveSession((s) => s.additionalDirs)
  const projectAdditionalDirs = useActiveSession((s) => s.projectAdditionalDirs)
  const projectLocalDirs = useActiveSession((s) => s.projectLocalDirs)
  const userAdditionalDirs = useActiveSession((s) => s.userAdditionalDirs)
  const addDir = useChatStore((s) => s.addDir)
  const removeDir = useChatStore((s) => s.removeDir)

  const removableInProject = new Set(projectLocalDirs)

  return (
    <div className={cn(
      'absolute bottom-full left-0 right-0 z-10 flex max-h-80 flex-col overflow-hidden border border-border bg-card',
      isCoding ? 'mb-1 rounded-xl' : 'mb-0.5 rounded-t-lg'
    )}>
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">/add-dir</span>
        <button
          onMouseDown={(e) => { e.preventDefault(); setShowDirManager(false) }}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border px-3 py-2 space-y-3">
        {userAdditionalDirs.length > 0 && (
          <DirSection label="User" dirs={userAdditionalDirs} scope="project" readOnly />
        )}
        <DirSection
          label="Project"
          dirs={projectAdditionalDirs}
          scope="project"
          removableSet={removableInProject}
          onAdd={addDir}
          onRemove={removeDir}
        />
        <DirSection label="Session" dirs={additionalDirs} scope="session" onAdd={addDir} onRemove={removeDir} />
      </div>
    </div>
  )
}
