import { useTranslation } from 'react-i18next'
import type { RecentFolder } from '@superone/shared/agent-types'
import { useAppStore } from '@/stores/app'
import { useHostProjects } from '@/hooks/use-host-projects'
import { displayHostPath } from '@/lib/remote-project-key'
import { Check, ChevronDown, Folder, FolderOpen, Plus, RotateCw } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'

interface ProjectSelectorProps {
  /** Compact mode for status bar usage */
  compact?: boolean
  /** Dropdown menu alignment */
  align?: 'start' | 'center' | 'end'
  /** Fires after a project is opened; lets the caller start a fresh session */
  onOpened?: () => void
  /**
   * When set, "Add Project..." calls this instead of the local folder picker.
   * Required for remote hosts (native picker is local-only).
   */
  onAddProject?: () => void
  /**
   * Move the open unsent draft onto the chosen project (new-session / draft
   * surface). Sidebar project hops must leave this off so the draft keeps its
   * saved project + worktree.
   */
  carryOpenDraft?: boolean
}

export function ProjectSelector({
  compact,
  align = 'start',
  onOpened,
  onAddProject,
  carryOpenDraft = false,
}: ProjectSelectorProps) {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const selectProject = useAppStore((s) => s.selectProject)
  const { connectionId, isLocal, projects, loading, error, refresh } = useHostProjects()

  const projectName =
    (currentFolder ? displayHostPath(currentFolder) : '').split(/[\\/]/).filter(Boolean).pop() ??
    'No Project'

  const openFolder = (folder: RecentFolder) => {
    void selectProject(folder.path, {
      connectionId,
      projectId: folder.id || undefined,
      carryOpenDraft,
    }).then(() => onOpened?.())
  }

  const addProject = () => {
    if (onAddProject) {
      onAddProject()
      return
    }
    // Local-only system picker; remote must pass onAddProject (AddProjectDialog).
    if (!isLocal) return
    void selectProject(undefined, { carryOpenDraft }).then(() => onOpened?.())
  }

  // Already bound to a project: always show its name, even while the host list
  // is still loading or briefly empty (remote listProjects race).
  const hasBoundProject = Boolean(currentFolder)

  if (loading && !hasBoundProject) {
    return compact ? (
      <span className="px-1 py-0.5 text-[11px] text-muted-foreground">…</span>
    ) : (
      <span className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">…</span>
    )
  }

  if (projects.length === 0 && !hasBoundProject) {
    return compact ? (
      <button
        onClick={addProject}
        className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <Plus className="size-3 shrink-0" />
        <span>Add Project...</span>
      </button>
    ) : (
      <button
        onClick={addProject}
        className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
      >
        <Plus className="size-4 shrink-0 text-muted-foreground" />
        <span>Add Project...</span>
      </button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <button className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
            <FolderOpen className="size-3 shrink-0" />
            <span className="truncate">{projectName}</span>
            <ChevronDown className="size-3 shrink-0 opacity-50" />
          </button>
        ) : (
          <button className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent">
            <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{projectName}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-64 overflow-hidden">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t('chat.suggestions.selectProject')}</DropdownMenuLabel>
        {/*
          Never render a silently blank menu: a remote host that failed to list
          (or has nothing registered) must say so, otherwise the only symptom is
          an empty dropdown with no way to tell a fetch error from an empty host.
        */}
        {error && (
          <>
            <div className="px-2 py-1.5 text-xs break-words text-destructive">{error}</div>
            {/* Manual retry after a failure skips the main-process cache. */}
            <DropdownMenuItem onClick={() => refresh({ force: true })} className="gap-2 focus-visible:shadow-none">
              <RotateCw className="size-4 shrink-0" />
              <span>{t('common.retry')}</span>
            </DropdownMenuItem>
          </>
        )}
        {!error && projects.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {t('chat.suggestions.noProjects')}
          </div>
        )}
        <div className="max-h-48 overflow-y-auto">
          {/*
            Stale entries stay visible but unopenable — same treatment as
            ProjectSidebarRow, so "every project is missing" reads as a host
            problem instead of an empty list.
          */}
          {projects.map((folder) => (
            <DropdownMenuItem
              key={folder.path}
              disabled={folder.missing}
              onClick={() => {
                if (folder.missing) return
                openFolder(folder)
              }}
              className="flex items-center justify-between focus-visible:shadow-none"
            >
              <div className="flex items-center gap-2 truncate">
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className={cn('truncate', folder.missing && 'text-muted-foreground line-through')}>
                  {folder.name}
                </span>
              </div>
              {folder.path === currentFolder && (
                <Check className="size-4 shrink-0 text-primary" />
              )}
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={addProject}
          className="gap-2 focus-visible:shadow-none"
        >
          <Plus className="size-4 shrink-0" />
          <span>Add Project...</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
