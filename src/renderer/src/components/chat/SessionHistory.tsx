import { useRef, useState, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ArrowLeft, Check, Copy, Eye, EyeOff, GitFork, MessageSquare, Pencil, Search, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getDeleteSessionRecovery } from '../session-delete-helpers'
import type { SessionHistoryEntry } from '../../../../shared/agent-types'

interface SessionHistoryProps {
  showBackButton?: boolean
  onClose?: () => void
}

export function SessionHistory({ showBackButton = true, onClose }: SessionHistoryProps) {
  const sessions = useActiveSession((s) => s.sessions)
  const sessionsHasMore = useActiveSession((s) => s.sessionsHasMore)
  const resumeSession = useChatStore((s) => s.resumeSession)
  const renameSession = useChatStore((s) => s.renameSession)
  const fetchSessions = useChatStore((s) => s.fetchSessions)
  const fetchSessionsPage = useChatStore((s) => s.fetchSessionsPage)
  const resetSession = useChatStore((s) => s.resetSession)
  const toggleHistory = useChatStore((s) => s.toggleHistory)
  const activeProject = useChatStore((s) => s.activeProject)
  const currentSessionId = useActiveSession((s) => s._activeSessionId ?? s.session?.sessionId)

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<SessionHistoryEntry | null>(null)
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

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

  const handleHide = async (sessionId: string) => {
    await window.app.hideSession(sessionId, true)
    fetchSessions()
  }

  const handleUnhide = async (sessionId: string) => {
    await window.app.hideSession(sessionId, false)
    fetchSessions()
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    await window.app.deleteSession(deleteTarget.sessionId)
    fetchSessions()
    if (currentSessionId === deleteTarget.sessionId) resetSession()
    setDeleteTarget(null)
    setCopiedCmd(null)
  }

  const deleteTargetCli = getDeleteSessionRecovery(deleteTarget?.provider ?? 'claude', deleteTarget?.sessionId ?? '')

  const filteredSessions = searchQuery
    ? sessions.filter((s) => s.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : sessions

  const virtualizer = useVirtualizer({
    count: filteredSessions.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 36,
    overscan: 5,
    getItemKey: (index) => filteredSessions[index]?.sessionId ?? index,
  })

  const loadingRef = useRef(false)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = (): void => {
      if (searchQuery || !sessionsHasMore || loadingRef.current) return
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
        loadingRef.current = true
        fetchSessionsPage().finally(() => { loadingRef.current = false })
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [searchQuery, sessionsHasMore, fetchSessionsPage])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        {showBackButton && (
          <Button size="icon-xs" variant="ghost" onClick={toggleHistory} className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
          </Button>
        )}
        {!showBackButton && onClose && (
          <span className="shrink-0 text-xs font-medium text-foreground/80">Sessions</span>
        )}
        <div className="flex flex-1 items-center gap-1.5 rounded-md border border-border/50 px-2 py-1">
          <Search className="size-3 shrink-0 text-muted-foreground/70" />
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sessions..."
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground/80 placeholder-muted-foreground/70 outline-none"
            autoFocus
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(''); searchRef.current?.focus() }} className="text-muted-foreground/70 hover:text-foreground/80">
              <X className="size-3" />
            </button>
          )}
        </div>
        {!showBackButton && onClose && (
          <Button size="icon-xs" variant="ghost" onClick={onClose} className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </Button>
        )}
      </div>
      {filteredSessions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground/70">
          No sessions found
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full" viewportRef={scrollRef}>
            <div
              style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
              className="w-0 min-w-full"
            >
              {virtualizer.getVirtualItems().map((vRow) => {
                const entry = filteredSessions[vRow.index]
                if (!entry) return null
                return (
                  <div
                    key={vRow.key}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${vRow.size}px`,
                      transform: `translateY(${vRow.start}px)`,
                    }}
                    className="px-2 pt-0.5"
                  >
                    <div
                      onClick={() => handleResume(entry)}
                      className={cn(
                        'group overflow-hidden rounded-md px-2.5 py-2 text-left transition-colors',
                        entry.sessionId === currentSessionId
                          ? 'bg-muted/60'
                          : 'cursor-pointer hover:bg-muted/40'
                      )}
                    >
                      {editingSessionId === entry.sessionId ? (
                        <input
                          className="w-full rounded border border-border/50 bg-background px-1 py-0.5 text-xs font-medium text-foreground/80 outline-none focus:ring-1 focus:ring-ring"
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
                          {entry.isWorktree ? <GitFork className="size-3 shrink-0 text-muted-foreground/70" /> : <MessageSquare className="size-3 shrink-0 text-muted-foreground/70" />}
                          <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/80">{entry.title}</div>
                          <div className="flex w-0 items-center gap-0.5 overflow-hidden opacity-0 transition-all group-hover:w-auto group-hover:opacity-100">
                            <button
                              onClick={(e) => { e.stopPropagation(); entry.isHidden ? handleUnhide(entry.sessionId) : handleHide(entry.sessionId) }}
                              className="rounded p-0.5 text-muted-foreground/70 hover:text-foreground/80"
                            >
                              {entry.isHidden ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                            </button>
                            <button
                              onClick={(e) => startEditing(entry, e)}
                              className="rounded p-0.5 text-muted-foreground/70 hover:text-foreground/80"
                            >
                              <Pencil className="size-3" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setDeleteTarget(entry) }}
                              className="rounded p-0.5 text-muted-foreground/70 hover:text-destructive"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        </div>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setCopiedCmd(null) } }}>
        <DialogContent showCloseButton={false} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Session?</DialogTitle>
            <DialogDescription asChild>
              <div>
                <span className="font-medium text-foreground">{deleteTarget?.title}</span> will be removed from SuperOne. You can still access it via {deleteTargetCli.cliName}:
                <div className="mt-2 flex flex-col gap-1">
                  {([
                    ['cd', `cd ${activeProject}`],
                    ['resume', deleteTargetCli.resumeCommand],
                  ] as const).map(([key, cmd]) => (
                    <code
                      key={key}
                      onClick={() => {
                        navigator.clipboard.writeText(cmd)
                        setCopiedCmd(key)
                        setTimeout(() => setCopiedCmd((v) => v === key ? null : v), 2000)
                      }}
                      className="flex cursor-pointer items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-xs text-foreground transition-colors hover:bg-muted/80"
                    >
                      <span className="min-w-0 truncate">{cmd}</span>
                      {copiedCmd === key
                        ? <Check className="size-3.5 shrink-0 text-green-500" />
                        : <Copy className="size-3.5 shrink-0 text-muted-foreground" />
                      }
                    </code>
                  ))}
                </div>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
