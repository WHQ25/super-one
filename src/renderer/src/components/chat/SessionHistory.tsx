import { useRef, useState, useEffect } from 'react'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { ArrowLeft, GitFork, Pencil, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SessionHistoryEntry } from '../../../../shared/agent-types'

interface SessionHistoryProps {
  /** Show back arrow button. Default true (canvas mode). Set false for sidebar usage. */
  showBackButton?: boolean
}

export function SessionHistory({ showBackButton = true }: SessionHistoryProps) {
  const sessions = useActiveSession((s) => s.sessions)
  const resumeSession = useChatStore((s) => s.resumeSession)
  const renameSession = useChatStore((s) => s.renameSession)
  const toggleHistory = useChatStore((s) => s.toggleHistory)
  const currentSessionId = useActiveSession((s) => s._activeSessionId ?? s.session?.sessionId)

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // ESC to close history (or cancel editing) — only when back button is shown (canvas mode)
  useEffect(() => {
    if (!showBackButton) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (editingSessionId) {
          setEditingSessionId(null)
        } else {
          toggleHistory()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showBackButton, toggleHistory, editingSessionId])

  const handleResume = (entry: SessionHistoryEntry) => {
    if (editingSessionId) return
    if (entry.sessionId === currentSessionId) return
    resumeSession(entry.sessionId)
  }

  const startEditing = (entry: SessionHistoryEntry, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingSessionId(entry.sessionId)
    setEditingTitle(entry.title)
  }

  const confirmRename = () => {
    if (!editingSessionId) return
    const trimmed = editingTitle.trim()
    if (trimmed) {
      renameSession(editingSessionId, trimmed)
    }
    setEditingSessionId(null)
  }

  const filteredSessions = searchQuery
    ? sessions.filter((s) => s.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : sessions

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {showBackButton && (
          <Button size="icon-xs" variant="ghost" onClick={toggleHistory} className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
          </Button>
        )}
        <div className="flex flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
          <Search className="size-3 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sessions..."
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder-muted-foreground outline-none"
            autoFocus
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(''); searchRef.current?.focus() }} className="text-muted-foreground hover:text-foreground">
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>
      {filteredSessions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          No sessions found
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="flex w-0 min-w-full flex-col gap-0.5 p-2">
              {filteredSessions.map((entry) => (
                <div
                  key={entry.sessionId}
                  onClick={() => handleResume(entry)}
                  className={cn(
                    'group overflow-hidden rounded-md px-2.5 py-2 text-left transition-colors',
                    entry.sessionId === currentSessionId
                      ? 'bg-accent'
                      : 'cursor-pointer hover:bg-muted'
                  )}
                >
                  {editingSessionId === entry.sessionId ? (
                    <input
                      className="w-full rounded border border-border bg-background px-1 py-0.5 text-xs font-medium outline-none focus:ring-1 focus:ring-ring"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return
                        if (e.key === 'Enter') { e.preventDefault(); confirmRename() }
                        if (e.key === 'Escape') { e.preventDefault(); setEditingSessionId(null) }
                      }}
                      onBlur={confirmRename}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <div className="flex items-center gap-1 overflow-hidden">
                      {entry.isWorktree && <GitFork className="size-3 shrink-0 text-muted-foreground" />}
                      <div className="min-w-0 flex-1 truncate text-xs font-medium">{entry.title}</div>
                      <button
                        onClick={(e) => startEditing(entry, e)}
                        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                      >
                        <Pencil className="size-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}
