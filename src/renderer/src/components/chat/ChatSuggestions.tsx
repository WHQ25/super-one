import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { homePath } from '@/lib/path-utils'

function ClaudeAgentIcon() {
  return (
    <svg viewBox="-3 -3 116 90" className="size-16" shapeRendering="crispEdges">
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0,0;2,-2;0,0;-2,-2;0,0"
          dur="2.5s"
          repeatCount="indefinite"
        />
        <g fill="#D67657">
          <rect x="10" y="0" width="90" height="60" />
          <rect x="0" y="20" width="10" height="20" />
          <rect x="100" y="20" width="10" height="20" />
        </g>
        <g fill="#1a1a1a">
          <rect x="20" y="20" width="10" height="10" />
          <rect x="80" y="20" width="10" height="10" />
          <animate
            attributeName="opacity"
            values="1;1;0;1;1"
            keyTimes="0;0.46;0.48;0.50;1"
            dur="4s"
            repeatCount="indefinite"
          />
        </g>
        <g fill="#D67657">
          <rect x="10" y="60" width="10" height="20">
            <animate attributeName="height" values="20;24;20;16;20" dur="2.5s" repeatCount="indefinite" />
          </rect>
          <rect x="30" y="60" width="10" height="20">
            <animate attributeName="height" values="20;24;20;16;20" dur="2.5s" repeatCount="indefinite" />
          </rect>
          <rect x="70" y="60" width="10" height="20">
            <animate attributeName="height" values="20;16;20;24;20" dur="2.5s" repeatCount="indefinite" />
          </rect>
          <rect x="90" y="60" width="10" height="20">
            <animate attributeName="height" values="20;16;20;24;20" dur="2.5s" repeatCount="indefinite" />
          </rect>
        </g>
      </g>
    </svg>
  )
}

function CodexAgentIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      className="size-16 text-emerald-500"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 20 L12 32 L22 44" strokeWidth="3">
        <animate attributeName="opacity" values="0.6;1;0.6" dur="3s" repeatCount="indefinite" />
      </path>
      <path d="M42 20 L52 32 L42 44" strokeWidth="3">
        <animate attributeName="opacity" values="0.6;1;0.6" dur="3s" begin="0.5s" repeatCount="indefinite" />
      </path>
      <rect x="30" y="22" width="4" height="20" rx="1" fill="currentColor" stroke="none">
        <animate attributeName="opacity" values="1;0.15;1" dur="1s" repeatCount="indefinite" />
      </rect>
    </svg>
  )
}

function ProviderSelector() {
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const setPreferredProvider = useChatStore((s) => s.setPreferredProvider)

  return (
    <div className="flex flex-col items-center gap-3">
      <AnimatePresence mode="wait">
        <motion.div
          key={preferredProvider}
          initial={{ opacity: 0, y: 12, scale: 0.85 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.85 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          {preferredProvider === 'claude' ? <ClaudeAgentIcon /> : <CodexAgentIcon />}
        </motion.div>
      </AnimatePresence>
      <Tabs value={preferredProvider} onValueChange={(v) => setPreferredProvider(v as ChatProvider)}>
        <TabsList className="rounded-lg p-1">
          <TabsTrigger value="claude" className="rounded-md px-3 py-1.5">Claude Code</TabsTrigger>
          <TabsTrigger value="codex" className="rounded-md px-3 py-1.5">Codex</TabsTrigger>
        </TabsList>
      </Tabs>
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
            <DropdownMenuContent align="center" className="max-h-80 w-64 overflow-y-auto">
              {recentFolders.map((folder) => (
                <DropdownMenuItem key={folder.path} onClick={() => openFolder(folder.path)} className="gap-2">
                  <span className="truncate">{folder.name}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {homePath(folder.path)}
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
