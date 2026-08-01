import { useTranslation } from 'react-i18next'
import type { RecentFolder } from '@superone/shared/agent-types'
import { useAppStore } from '@/stores/app'
import { useHostProjects } from '@/hooks/use-host-projects'
import { displayHostPath } from '@/lib/remote-project-key'
import { Check, ChevronDown, Folder, FolderOpen, Plus } from 'lucide-react'
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
}

export function ProjectSelector({ compact, align = 'start', onOpened, onAddProject }: ProjectSelectorProps) {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const selectProject = useAppStore((s) => s.selectProject)
  const { connectionId, isLocal, projects, loading } = useHostProjects()

  const projectName =
    (currentFolder ? displayHostPath(currentFolder) : '').split(/[\\/]/).filter(Boolean).pop() ??
    'No Project'

  const openFolder = (folder: RecentFolder) => {
    void selectProject(folder.path, {
      connectionId,
      projectId: folder.id || undefined,
    }).then(() => onOpened?.())
  }

  const addProject = () => {
    if (onAddProject) {
      onAddProject()
      return
    }
    // Local-only system picker; remote must pass onAddProject (AddProjectDialog).
    if (!isLocal) return
    void selectProject().then(() => onOpened?.())
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
        <div className="max-h-48 overflow-y-auto">
          {projects.filter((f) => !f.missing).map((folder) => (
            <DropdownMenuItem
              key={folder.path}
              onClick={() => openFolder(folder)}
              className="flex items-center justify-between focus-visible:shadow-none"
            >
              <div className="flex items-center gap-2 truncate">
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{folder.name}</span>
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
