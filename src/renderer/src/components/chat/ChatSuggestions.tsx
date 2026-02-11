import { useState } from 'react'
import { useChatStore } from '@/stores/chat'
import { useAppStore, useHasRealProject } from '@/stores/app'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Plus, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

const CANVAS_SUGGESTIONS = [
  'Design a modern SaaS dashboard',
  'Create a landing page for a mobile app',
  'Build a settings page with sidebar nav',
  'Design a login and signup flow',
]

const CODING_SUGGESTIONS = [
  'Explain the project structure',
  'Find and fix potential bugs',
  'Add unit tests for the main module',
  'Refactor for better readability',
]

export function ChatSuggestions() {
  const sendMessage = useChatStore((s) => s.sendMessage)
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

  const suggestions = isCoding ? CODING_SUGGESTIONS : CANVAS_SUGGESTIONS

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-4">
      {isCoding ? (
        <ProjectSelector />
      ) : (
        <p className="text-sm font-medium text-foreground">Try an example to design...</p>
      )}
      <div className="flex w-full flex-col gap-2">
        {suggestions.map((text) => (
          <button
            key={text}
            onClick={() => sendMessage(text)}
            className="rounded-lg border border-amber-500/30 px-3 py-2 text-left text-sm text-amber-500 transition-colors hover:border-amber-500/60 hover:bg-amber-500/10"
          >
            {text}
          </button>
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        {isCoding
          ? 'Claude Code will help you build and iterate on your project.'
          : 'Claude Code will help you design and iterate on your product.'}
      </p>
    </div>
  )
}
