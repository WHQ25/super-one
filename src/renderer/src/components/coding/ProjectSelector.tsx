import { useAppStore } from '@/stores/app'
import { Check, ChevronDown, FolderOpen, Plus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface ProjectSelectorProps {
  /** Compact mode for status bar usage */
  compact?: boolean
}

export function ProjectSelector({ compact }: ProjectSelectorProps) {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const recentFolders = useAppStore((s) => s.recentFolders)
  const openFolder = useAppStore((s) => s.openFolder)
  const selectAndOpenFolder = useAppStore((s) => s.selectAndOpenFolder)

  const projectName = currentFolder?.split('/').pop() ?? 'No Project'

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
      <DropdownMenuContent align="start" className="w-64">
        {recentFolders.map((folder) => (
          <DropdownMenuItem
            key={folder.path}
            onClick={() => openFolder(folder.path)}
            className="gap-2"
          >
            {folder.path === currentFolder ? (
              <Check className="size-4 shrink-0" />
            ) : (
              <span className="size-4 shrink-0" />
            )}
            <span className="truncate">{folder.path.split('/').pop()}</span>
            <span className="ml-auto truncate text-xs text-muted-foreground">
              {folder.path.replace(/^\/Users\/[^/]+/, '~')}
            </span>
          </DropdownMenuItem>
        ))}
        {recentFolders.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={() => selectAndOpenFolder()} className="gap-2">
          <Plus className="size-4 shrink-0" />
          <span>Add Project...</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
