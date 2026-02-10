import { useEffect, useState } from 'react'
import { Clock, Pencil, Trash2, Check, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useChatStore } from '@/stores/chat'
import type { SessionHistoryEntry } from '../../../../shared/agent-types'

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(isoDate).toLocaleDateString()
}

function SessionItem({ entry, currentSessionId, onResume, onClose }: {
  entry: SessionHistoryEntry
  currentSessionId: string
  onResume: (id: string) => void
  onClose: () => void
}) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [newName, setNewName] = useState(entry.name)
  const { deleteSessionHistory, renameSessionHistory } = useChatStore()
  const isCurrent = entry.sessionId === currentSessionId

  const handleRename = async () => {
    if (newName.trim() && newName !== entry.name) {
      await renameSessionHistory(entry.sessionId, newName.trim())
    }
    setIsRenaming(false)
  }

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await deleteSessionHistory(entry.sessionId)
  }

  const handleClick = () => {
    if (isCurrent || isRenaming) return
    onResume(entry.sessionId)
    onClose()
  }

  return (
    <div
      onClick={handleClick}
      className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
        isCurrent ? 'bg-accent' : 'cursor-pointer hover:bg-muted'
      }`}
    >
      <div className="flex-1 min-w-0">
        {isRenaming ? (
          <div className="flex items-center gap-1">
            <input
              className="flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs outline-none focus:border-ring"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename()
                if (e.key === 'Escape') setIsRenaming(false)
              }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
            <Button size="icon-xs" variant="ghost" onClick={(e) => { e.stopPropagation(); handleRename() }}>
              <Check className="size-3" />
            </Button>
            <Button size="icon-xs" variant="ghost" onClick={(e) => { e.stopPropagation(); setIsRenaming(false) }}>
              <X className="size-3" />
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs font-medium">{entry.name}</span>
              {isCurrent && <Badge variant="secondary" className="text-[9px] px-1">current</Badge>}
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>{formatRelativeTime(entry.lastActiveAt)}</span>
              <span>{entry.messageCount} msgs</span>
              {entry.totalCostUsd > 0 && <span>${entry.totalCostUsd.toFixed(3)}</span>}
            </div>
          </>
        )}
      </div>

      {!isRenaming && (
        <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button size="icon-xs" variant="ghost" onClick={(e) => { e.stopPropagation(); setIsRenaming(true); setNewName(entry.name) }} className="text-muted-foreground hover:text-foreground">
            <Pencil className="size-3" />
          </Button>
          {!isCurrent && (
            <Button size="icon-xs" variant="ghost" onClick={handleDelete} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="size-3" />
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export function SessionPopover() {
  const [open, setOpen] = useState(false)
  const { session, sessions, fetchSessions, resetSession, resumeSession } = useChatStore()

  useEffect(() => {
    if (open) fetchSessions()
  }, [open, fetchSessions])

  const handleNewChat = async () => {
    await resetSession()
    setOpen(false)
  }

  const handleResume = async (sessionId: string) => {
    await resumeSession(sessionId)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground">
          <Clock className="size-4" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="center" side="bottom" sideOffset={8}>
        {/* Current session info */}
        {session && (
          <div className="mb-2 rounded-md bg-muted/50 px-2 py-1.5 text-[10px] text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>{session.model}</span>
              <span>${useChatStore.getState().totalCostUsd.toFixed(3)}</span>
            </div>
          </div>
        )}

        {/* New Chat button */}
        <Button variant="outline" size="sm" className="mb-2 w-full" onClick={handleNewChat}>
          New Chat
        </Button>

        {/* Session history */}
        {sessions.length > 0 && (
          <>
            <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              History
            </div>
            <ScrollArea className="max-h-64">
              <div className="flex flex-col gap-0.5">
                {sessions
                  .sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime())
                  .map((entry) => (
                    <SessionItem
                      key={entry.sessionId}
                      entry={entry}
                      currentSessionId={session?.sessionId ?? ''}
                      onResume={handleResume}
                      onClose={() => setOpen(false)}
                    />
                  ))}
              </div>
            </ScrollArea>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
