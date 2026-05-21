import { useRef, useState, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useChatStore, SESSIONS_PAGE_SIZE } from '@/stores/chat'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { Button } from '@superone/ui/components/ui/button'
import { Checkbox } from '@superone/ui/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@superone/ui/components/ui/dropdown-menu'
import { ArrowLeft, Check, Copy, Eye, EyeOff, GitFork, MessageSquare, MoreHorizontal, Pencil, Search, Trash2, X } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { getDeleteSessionRecovery, shouldSkipDeleteConfirm, setSkipDeleteConfirm } from '../session-delete-helpers'
import { SessionTitleAnimated } from '@/components/sidebar/AnimatedSessionTitle'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'


interface SessionHistoryProps {
  folderPath: string
  showBackButton?: boolean
  onClose: () => void
}

export function SessionHistory({ folderPath, showBackButton = true, onClose }: SessionHistoryProps) {
  const switchToSession = useChatStore((s) => s.switchToSession)
  const resetSession = useChatStore((s) => s.resetSession)
  const activeProject = useChatStore((s) => s.activeProject)
  const currentSessionId = useChatStore((s) => s.projectSessions[folderPath]?._activeSessionId ?? null)

  const [sessions, setSessions] = useState<SessionHistoryEntry[]>([])
  const [sessionsHasMore, setSessionsHasMore] = useState(false)
  const pageRef = useRef(0)

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<SessionHistoryEntry | null>(null)
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null)
  const [skipConfirm, setSkipConfirm] = useState(false)
  const [showDeleteAll, setShowDeleteAll] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const fetchSessions = useCallback(async () => {
    try {
      const page = await window.app.listSessionsForFolderPage(folderPath, SESSIONS_PAGE_SIZE, 0)
      setSessions(page)
      setSessionsHasMore(page.length >= SESSIONS_PAGE_SIZE)
      pageRef.current = 1
    } catch (err) { console.warn('[history] fetchSessions failed:', err) }
  }, [folderPath])

  const fetchSessionsPage = useCallback(async () => {
    const offset = pageRef.current * SESSIONS_PAGE_SIZE
    try {
      const page = await window.app.listSessionsForFolderPage(folderPath, SESSIONS_PAGE_SIZE, offset)
      setSessions((prev) => [...prev, ...page])
      setSessionsHasMore(page.length >= SESSIONS_PAGE_SIZE)
      pageRef.current += 1
    } catch (err) { console.warn('[history] fetchSessionsPage failed:', err) }
  }, [folderPath])

  useEffect(() => { void fetchSessions() }, [fetchSessions])

  useEffect(() => {
    if (!showBackButton) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (editingSessionId) {
          setEditingSessionId(null)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showBackButton, onClose, editingSessionId])

  const handleResume = (entry: SessionHistoryEntry) => {
    if (editingSessionId) return
    void switchToSession(folderPath, entry.sessionId)
  }

  const startEditing = (entry: SessionHistoryEntry, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingSessionId(entry.sessionId)
    setEditingTitle(entry.title)
  }

  const confirmRename = async () => {
    if (!editingSessionId) return
    const trimmed = editingTitle.trim()
    const sessionId = editingSessionId
    setEditingSessionId(null)
    if (!trimmed) return
    await window.app.renameSession(sessionId, trimmed)
    setSessions((prev) => prev.map((entry) =>
      entry.sessionId === sessionId ? { ...entry, title: trimmed } : entry
    ))
  }

  const handleHide = async (sessionId: string) => {
    await window.app.hideSession(sessionId, true)
    fetchSessions()
  }

  const handleUnhide = async (sessionId: string) => {
    await window.app.hideSession(sessionId, false)
    fetchSessions()
  }

  const executeDelete = async (target: SessionHistoryEntry) => {
    await window.app.deleteSession(target.sessionId)
    fetchSessions()
    if (folderPath === activeProject && currentSessionId === target.sessionId) resetSession()
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    if (skipConfirm) setSkipDeleteConfirm()
    await executeDelete(deleteTarget)
    setDeleteTarget(null)
    setCopiedCmd(null)
    setSkipConfirm(false)
  }

  const deleteAllCount = sessions.filter((s) => !s.isPinned).length

  const handleDeleteAll = useCallback(async () => {
    const deleted = await window.app.deleteSessionsOlderThan(folderPath, new Date(Date.now() + 86400000).toISOString())
    fetchSessions()
    if (folderPath === activeProject && currentSessionId && deleted.includes(currentSessionId)) resetSession()
    setShowDeleteAll(false)
  }, [folderPath, activeProject, currentSessionId, fetchSessions, resetSession])

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
        {showBackButton ? (
          <Button size="icon-xs" variant="ghost" onClick={onClose} className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
          </Button>
        ) : (
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-xs" variant="ghost" className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onClick={() => setShowDeleteAll(true)} className="text-xs">
              <Trash2 className="size-3.5" />
              Delete all
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {!showBackButton && (
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
                          <MessageSquare className="size-3 shrink-0 text-muted-foreground/70" />
                          <SessionTitleAnimated sessionId={entry.sessionId} fallback={entry.title} className="min-w-0 flex-1 text-sm font-medium text-foreground/80" />
                          <div className="flex w-0 items-center gap-0.5 overflow-hidden opacity-0 transition-all group-hover:w-auto group-hover:opacity-100">
                            {entry.isWorktree && (
                              <span title="Worktree" className="p-0.5 text-muted-foreground/70">
                                <GitFork className="size-3" />
                              </span>
                            )}
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
                              onClick={(e) => {
                                e.stopPropagation()
                                if (shouldSkipDeleteConfirm()) {
                                  executeDelete(entry)
                                } else {
                                  setDeleteTarget(entry)
                                }
                              }}
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
              <div className="min-w-0">
                <span className="font-medium text-foreground">{deleteTarget?.title}</span> will be removed from SuperOne. You can still access it via {deleteTargetCli.cliName}:
                <div className="mt-2 flex min-w-0 flex-col gap-1">
                  {([
                    ['cd', `cd ${folderPath}`],
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
          <DialogFooter className="flex-row items-center gap-2">
            <label className="mr-auto flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox checked={skipConfirm} onCheckedChange={(v) => setSkipConfirm(v === true)} />
              Don't ask again
            </label>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setSkipConfirm(false) }}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteAll} onOpenChange={(open) => { if (!open) setShowDeleteAll(false) }}>
        <DialogContent showCloseButton={false} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete All Sessions?</DialogTitle>
            <DialogDescription>
              {deleteAllCount === 0
                ? 'No non-pinned sessions found.'
                : `This will delete ${deleteAllCount} non-pinned session${deleteAllCount > 1 ? 's' : ''}. Pinned sessions will not be affected.`
              }
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteAll(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteAll} disabled={deleteAllCount === 0}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
