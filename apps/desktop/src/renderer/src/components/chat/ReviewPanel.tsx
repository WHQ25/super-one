import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { cn } from '@superone/ui/lib/utils'
import { useChatStore } from '@/stores/chat'
import { X, GitCommitHorizontal, GitBranch, FileDiff, Search, Loader2 } from 'lucide-react'
import type { GitLogEntry, CodexReviewTarget } from '@superone/shared/agent-types'
import { fuzzyMatch } from '@/lib/fuzzy-match'

type ReviewMode = 'uncommitted' | 'branch' | 'commit'

function HighlightText({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>
  const set = new Set(indices)
  const parts: React.ReactNode[] = []
  let run = ''
  let inHighlight = false
  for (let i = 0; i < text.length; i++) {
    const isMatch = set.has(i)
    if (isMatch !== inHighlight) {
      if (run) parts.push(inHighlight ? <mark key={i} className="bg-transparent text-orange-600 dark:text-orange-400 font-semibold">{run}</mark> : run)
      run = ''
      inHighlight = isMatch
    }
    run += text[i]
  }
  if (run) parts.push(inHighlight ? <mark key="end" className="bg-transparent text-orange-600 dark:text-orange-400 font-semibold">{run}</mark> : run)
  return <>{parts}</>
}

export function ReviewPanel() {
  const setShowReviewPanel = useChatStore((s) => s.setShowReviewPanel)
  const startCodexReview = useChatStore((s) => s.startCodexReview)
  const activeProject = useChatStore((s) => s.activeProject)

  const [mode, setMode] = useState<ReviewMode>('uncommitted')
  const [commits, setCommits] = useState<GitLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedCommitIndex, setSelectedCommitIndex] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const commitListRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mode !== 'commit' || !activeProject) return
    let cancelled = false
    setLoading(true)
    void window.app.getGitLog(activeProject).then((entries) => {
      if (cancelled) return
      setCommits(entries)
      setSelectedCommitIndex(0)
      setLoading(false)
    }).catch(() => {
      if (cancelled) return
      setCommits([])
      setSelectedCommitIndex(0)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [mode, activeProject])

  useEffect(() => {
    if (mode === 'commit') {
      setTimeout(() => searchInputRef.current?.focus(), 50)
      return
    }
    setTimeout(() => panelRef.current?.focus(), 50)
  }, [mode])

  type ScoredCommit = GitLogEntry & { msgIndices: number[]; shaIndices: number[] }

  const filteredCommits: ScoredCommit[] = useMemo(() => {
    const q = query.trim()
    if (!q) return commits.map((c) => ({ ...c, msgIndices: [], shaIndices: [] }))
    return commits
      .map((c) => {
        const msgResult = fuzzyMatch(q, c.message)
        const shaResult = fuzzyMatch(q, c.sha)
        const score = Math.max(msgResult.score, shaResult.score)
        return { ...c, msgIndices: msgResult.indices, shaIndices: shaResult.indices, match: msgResult.match || shaResult.match, score }
      })
      .filter((x) => x.match)
      .sort((a, b) => b.score - a.score)
  }, [commits, query])

  useEffect(() => {
    setSelectedCommitIndex(0)
  }, [query])

  const confirm = useCallback((target: CodexReviewTarget) => {
    startCodexReview(target)
  }, [startCodexReview])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      setShowReviewPanel(false)
      return
    }

    if (mode !== 'commit') {
      const modes: ReviewMode[] = ['uncommitted', 'branch', 'commit']
      const idx = modes.indexOf(mode)
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault()
        setMode(modes[Math.min(idx + 1, modes.length - 1)])
        return
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault()
        if (idx > 0) setMode(modes[idx - 1])
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (mode === 'uncommitted') confirm({ type: 'uncommittedChanges' })
        else if (mode === 'branch') confirm({ type: 'baseBranch' })
        return
      }
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedCommitIndex((i) => Math.min(i + 1, filteredCommits.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedCommitIndex((i) => {
        if (i <= 0) {
          setMode('branch')
          return 0
        }
        return i - 1
      })
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const commit = filteredCommits[selectedCommitIndex]
      if (commit) confirm({ type: 'commit', sha: commit.sha, title: commit.message })
      return
    }
  }, [mode, filteredCommits, selectedCommitIndex, confirm, setShowReviewPanel])

  useEffect(() => {
    const el = commitListRef.current?.querySelector('[data-selected="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedCommitIndex])

  const modeOptions: { key: ReviewMode; icon: typeof FileDiff; label: string }[] = [
    { key: 'uncommitted', icon: FileDiff, label: 'Uncommitted Changes' },
    { key: 'branch', icon: GitBranch, label: 'Base Branch' },
    { key: 'commit', icon: GitCommitHorizontal, label: 'Specific Commit' },
  ]

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="absolute bottom-full left-0 right-0 z-10 mb-1 flex max-h-80 flex-col overflow-hidden rounded-xl border border-border bg-card outline-none"
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">/review</span>
        <button
          onMouseDown={(e) => { e.preventDefault(); setShowReviewPanel(false) }}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border px-3 py-2 space-y-1">
        {modeOptions.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onMouseDown={(e) => {
              e.preventDefault()
              if (key === 'commit') {
                setMode('commit')
              } else {
                const target: CodexReviewTarget = key === 'uncommitted'
                  ? { type: 'uncommittedChanges' }
                  : { type: 'baseBranch' }
                confirm(target)
              }
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
              mode === key
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
            )}
          >
            <Icon className="size-3.5" />
            <span>{label}</span>
          </button>
        ))}

        {mode === 'commit' && (
          <div className="mt-1.5 space-y-1">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search commits..."
                className="w-full rounded-md border border-border bg-background py-1 pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div ref={commitListRef} className="max-h-40 overflow-y-auto rounded-md border border-border">
              {loading ? (
                <div className="flex items-center justify-center gap-1.5 py-4 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  <span>Loading commits...</span>
                </div>
              ) : filteredCommits.length === 0 ? (
                <div className="py-4 text-center text-xs text-muted-foreground/60">No commits found</div>
              ) : (
                filteredCommits.map((commit, i) => (
                  <button
                    key={commit.sha}
                    data-selected={i === selectedCommitIndex}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      confirm({ type: 'commit', sha: commit.sha, title: commit.message })
                    }}
                    onMouseEnter={() => setSelectedCommitIndex(i)}
                    className={cn(
                      'flex w-full items-start gap-2 px-2 py-1.5 text-left text-xs transition-colors',
                      i === selectedCommitIndex ? 'bg-muted' : 'hover:bg-muted/50'
                    )}
                  >
                    <code className="shrink-0 font-mono text-blue-600 dark:text-blue-400"><HighlightText text={commit.sha.slice(0, 7)} indices={commit.shaIndices.filter((i) => i < 7)} /></code>
                    <span className="min-w-0 truncate text-foreground"><HighlightText text={commit.message} indices={commit.msgIndices} /></span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-border px-3 py-1 text-[10px] text-muted-foreground/60">
        <span><kbd className="rounded border border-border px-1">↵</kbd> confirm</span>
        <span><kbd className="rounded border border-border px-1">↑↓</kbd> navigate</span>
        <span><kbd className="rounded border border-border px-1">esc</kbd> close</span>
      </div>
    </div>
  )
}
