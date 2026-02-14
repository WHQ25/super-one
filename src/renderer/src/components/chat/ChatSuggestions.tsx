import { useState } from 'react'
import { useAppStore, useHasRealProject } from '@/stores/app'
import { useActiveSession, useChatStore, type ChatProvider } from '@/stores/chat'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

function ProviderSelector() {
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const setPreferredProvider = useChatStore((s) => s.setPreferredProvider)

  const options: Array<{ value: ChatProvider; label: string }> = [
    { value: 'claude', label: 'Claude Code' },
    { value: 'codex', label: 'Codex' },
  ]

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Agent</p>
      <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
        {options.map((option) => {
          const active = preferredProvider === option.value
          return (
            <button
              key={option.value}
              onClick={() => setPreferredProvider(option.value)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors',
                active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <span>{option.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function ChatSuggestions() {
  const layoutMode = useAppStore((s) => s.layoutMode)
  const selectAndOpenFolder = useAppStore((s) => s.selectAndOpenFolder)
  const openFolder = useAppStore((s) => s.openFolder)
  const recentFolders = useAppStore((s) => s.recentFolders)
  const hasRealProject = useHasRealProject()

  const [addOpen, setAddOpen] = useState(false)

  const isCoding = layoutMode === 'coding'

  // Coding mode: no real project (running on tmp folder)
  if (isCoding && !hasRealProject) {
    const hasRecent = recentFolders.length > 0
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-4">
        <ProviderSelector />
        <p className="text-sm text-muted-foreground">Open a project to get started</p>
        {hasRecent ? (
          <DropdownMenu onOpenChange={setAddOpen}>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent">
                Add Project
                <ChevronDown className={cn('size-4 text-muted-foreground transition-transform duration-200', addOpen && 'rotate-180')} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-64">
              {recentFolders.map((folder) => (
                <DropdownMenuItem key={folder.path} onClick={() => openFolder(folder.path)} className="gap-2">
                  <span className="truncate">{folder.name}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {folder.path.replace(/^\/Users\/[^/]+/, '~')}
                  </span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => selectAndOpenFolder()} className="gap-2">
                <Plus className="size-4 shrink-0" />
                <span>Add Project</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            onClick={() => selectAndOpenFolder()}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Add Project
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-4">
      <ProviderSelector />
      {isCoding && <ProjectSelector align="center" />}
    </div>
  )
}
