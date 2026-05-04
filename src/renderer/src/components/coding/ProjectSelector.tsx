import { useAppStore } from '@/stores/app'
import { Check, ChevronDown, Folder, FolderOpen, Plus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface ProjectSelectorProps {
  /** Compact mode for status bar usage */
  compact?: boolean
  /** open: switch and initialize agent; switch: only switch settings context */
  mode?: 'open' | 'switch'
  /** Dropdown menu alignment */
  align?: 'start' | 'center' | 'end'
}

export function ProjectSelector({ compact, mode = 'open', align = 'start' }: ProjectSelectorProps) {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const recentFolders = useAppStore((s) => s.recentFolders)
  const openFolder = useAppStore((s) => s.openFolder)
  const switchToProject = useAppStore((s) => s.switchToProject)
  const selectAndOpenFolder = useAppStore((s) => s.selectAndOpenFolder)
  const selectAndSwitchFolder = useAppStore((s) => s.selectAndSwitchFolder)

  const projectName = currentFolder?.split('/').pop() ?? 'No Project'
  const handleAddProject = mode === 'switch' ? selectAndSwitchFolder : selectAndOpenFolder

  if (recentFolders.length === 0) {
    return compact ? (
      <button
        onClick={() => void handleAddProject()}
        className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <Plus className="size-3 shrink-0" />
        <span>Add Project...</span>
      </button>
    ) : (
      <button
        onClick={() => void handleAddProject()}
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
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Select Project</DropdownMenuLabel>
        <div className="max-h-48 overflow-y-auto">
          {recentFolders.filter((f) => !f.missing).map((folder) => (
            <DropdownMenuItem
              key={folder.path}
              onClick={() => {
                if (mode === 'switch') {
                  switchToProject(folder.path)
                } else {
                  void openFolder(folder.path)
                }
              }}
              className="flex items-center justify-between focus-visible:shadow-none"
            >
              <div className="flex items-center gap-2 truncate">
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{folder.name}</span>
              </div>
              {folder.path === currentFolder && (
                <Check className="size-4 shrink-0 text-muted-foreground" />
              )}
            </DropdownMenuItem>
          ))}
        </div>
        {recentFolders.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem
          onClick={() => {
            if (mode === 'switch') {
              void selectAndSwitchFolder()
            } else {
              void selectAndOpenFolder()
            }
          }}
          className="gap-2 focus-visible:shadow-none"
        >
          <Plus className="size-4 shrink-0" />
          <span>Add Project...</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
