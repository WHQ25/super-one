import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Folder, FolderPlus, X } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { HighlightedText } from '@superone/ui/components/ui/HighlightedText'
import { useActiveSession } from '@/stores/chat'
import { useEffectiveProjectRoot } from '@/stores/app'
import { fuzzyMatch } from '@/lib/fuzzy-match'
import type { ListDirEntry } from '@superone/shared/agent-types'

export interface AddDirPopupHandle {
  confirmTab: () => void
  confirmEnter: () => void
  getItemCount: () => number
}

interface AddDirPopupProps {
  argsText: string
  selectedIndex: number
  onSetSelectedIndex: (index: number) => void
  onScopeFill: (scope: 'project' | 'session') => void
  onPathNavigate: (nextPathInput: string) => void
  onPathCommit: (absolutePath: string, scope: 'project' | 'session') => void
  onAddViaPicker: (scope: 'project' | 'session') => void
  onRemoveDir: (path: string, scope: 'project' | 'session') => void
}

type Scope = 'project' | 'session'

interface OverviewPhase { kind: 'overview' }
interface ScopePhase { kind: 'scope'; partial: string }
interface PathPhase { kind: 'path'; scope: Scope; pathInput: string; parent: string; partial: string }
type Phase = OverviewPhase | ScopePhase | PathPhase

function parseArgs(argsText: string): Phase {
  if (argsText === '') return { kind: 'overview' }
  const m = argsText.match(/^(project|session)\s(.*)$/s)
  if (m) {
    const scope = m[1] as Scope
    const pathInput = m[2]
    const lastSlash = pathInput.lastIndexOf('/')
    const parent = lastSlash >= 0 ? pathInput.slice(0, lastSlash + 1) : ''
    const partial = lastSlash >= 0 ? pathInput.slice(lastSlash + 1) : pathInput
    return { kind: 'path', scope, pathInput, parent, partial }
  }
  return { kind: 'scope', partial: argsText }
}

interface ScopeCandidate {
  scope: Scope
  matchIndices: number[]
  score: number
}

function buildScopeCandidates(partial: string): ScopeCandidate[] {
  const all: Scope[] = ['project', 'session']
  const trimmed = partial.trimStart()
  if (!trimmed) return all.map((s) => ({ scope: s, matchIndices: [], score: 0 }))
  const lower = trimmed.toLowerCase()
  return all
    .filter((s) => s.startsWith(lower))
    .map((s) => ({ scope: s, matchIndices: lower.split('').map((_, i) => i), score: 1 }))
}

interface PathCandidate {
  entry: ListDirEntry
  matchIndices: number[]
  score: number
}

function rankEntries(entries: ListDirEntry[], partial: string): PathCandidate[] {
  const dirs = entries.filter((e) => e.isDirectory)
  if (!partial) return dirs.map((e) => ({ entry: e, matchIndices: [], score: 0 }))
  return dirs
    .map((entry) => {
      const r = fuzzyMatch(partial.toLowerCase(), entry.name)
      return { entry, matchIndices: r.indices, score: r.score, matched: r.match }
    })
    .filter((c) => c.matched)
    .sort((a, b) => b.score - a.score)
    .map(({ entry, matchIndices, score }) => ({ entry, matchIndices, score }))
}

function joinPath(parent: string, name: string, isDir: boolean): string {
  return parent + name + (isDir ? '/' : '')
}

export const AddDirPopup = forwardRef<AddDirPopupHandle, AddDirPopupProps>(
  function AddDirPopup({ argsText, selectedIndex, onSetSelectedIndex, onScopeFill, onPathNavigate, onPathCommit, onAddViaPicker, onRemoveDir }, ref) {
    const fileRoot = useEffectiveProjectRoot()
    const additionalDirs = useActiveSession((s) => s.additionalDirs)
    const projectSharedDirs = useActiveSession((s) => s.projectSharedDirs)
    const projectLocalDirs = useActiveSession((s) => s.projectLocalDirs)
    const userAdditionalDirs = useActiveSession((s) => s.userAdditionalDirs)
    const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())
    const [entries, setEntries] = useState<ListDirEntry[]>([])
    const [absolutePath, setAbsolutePath] = useState<string>('')
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

    const phase = useMemo(() => parseArgs(argsText), [argsText])

    useEffect(() => {
      if (phase.kind !== 'path') {
        setEntries([])
        setAbsolutePath('')
        return
      }
      if (debounceRef.current) clearTimeout(debounceRef.current)
      const parent = phase.parent
      debounceRef.current = setTimeout(() => {
        if (!fileRoot) return
        window.agent
          .listDirectoryForAddDir(fileRoot, parent)
          .then((res) => {
            setEntries(res.entries)
            setAbsolutePath(res.absolutePath)
          })
          .catch(() => {
            setEntries([])
            setAbsolutePath('')
          })
      }, 100)
      return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    }, [phase, fileRoot])

    useEffect(() => {
      if (selectedIndex >= 0) {
        itemRefs.current.get(selectedIndex)?.scrollIntoView({ block: 'nearest' })
      }
    }, [selectedIndex])

    const scopeCandidates = useMemo(
      () => (phase.kind === 'scope' ? buildScopeCandidates(phase.partial) : []),
      [phase]
    )
    const pathCandidates = useMemo(
      () => (phase.kind === 'path' ? rankEntries(entries, phase.partial) : []),
      [phase, entries]
    )

    const itemCount = useMemo(() => {
      if (phase.kind === 'scope') return scopeCandidates.length
      if (phase.kind === 'path') return pathCandidates.length
      return 0
    }, [phase, scopeCandidates.length, pathCandidates.length])

    const safeSelectedIndex = Math.max(0, Math.min(selectedIndex, itemCount - 1))

    const commitSelectedPath = useCallback(() => {
      if (phase.kind !== 'path') return
      const candidate = pathCandidates[safeSelectedIndex]
      if (candidate) {
        const fullPath = (absolutePath.endsWith('/') ? absolutePath : absolutePath + '/') + candidate.entry.name
        onPathCommit(fullPath, phase.scope)
        return
      }
      if (absolutePath && (phase.partial === '' || phase.pathInput === '')) {
        onPathCommit(absolutePath, phase.scope)
      }
    }, [phase, pathCandidates, safeSelectedIndex, absolutePath, onPathCommit])

    const navigateSelectedPath = useCallback(() => {
      if (phase.kind !== 'path') return
      const candidate = pathCandidates[safeSelectedIndex]
      if (!candidate) return
      const next = joinPath(phase.parent, candidate.entry.name, candidate.entry.isDirectory)
      onPathNavigate(next)
    }, [phase, pathCandidates, safeSelectedIndex, onPathNavigate])

    useImperativeHandle(
      ref,
      () => ({
        getItemCount: () => itemCount,
        confirmTab: () => {
          if (phase.kind === 'scope') {
            const cand = scopeCandidates[safeSelectedIndex]
            if (cand) onScopeFill(cand.scope)
            return
          }
          if (phase.kind === 'path') {
            const cand = pathCandidates[safeSelectedIndex]
            if (cand && cand.entry.isDirectory) {
              navigateSelectedPath()
            } else {
              commitSelectedPath()
            }
          }
        },
        confirmEnter: () => {
          if (phase.kind === 'scope') {
            const cand = scopeCandidates[safeSelectedIndex]
            if (cand) onScopeFill(cand.scope)
            return
          }
          if (phase.kind === 'path') {
            commitSelectedPath()
          }
        },
      }),
      [phase, scopeCandidates, pathCandidates, safeSelectedIndex, onScopeFill, navigateSelectedPath, commitSelectedPath, itemCount]
    )

    return (
      <div className="absolute bottom-full left-0 right-0 z-10 mb-1 max-h-72 overflow-hidden rounded-xl border border-border bg-popover flex flex-col">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
          <span className="text-xs font-medium text-muted-foreground">/add-dir</span>
          {phase.kind === 'path' && absolutePath && (
            <span className="text-xs text-muted-foreground/70 truncate ml-2 max-w-[60%]">{absolutePath}</span>
          )}
        </div>

        <div className="overflow-y-auto p-1 flex-1 min-h-0">
          {phase.kind === 'overview' && (
            <OverviewView
              user={userAdditionalDirs}
              projectShared={projectSharedDirs}
              projectLocal={projectLocalDirs}
              session={additionalDirs}
              onAddViaPicker={onAddViaPicker}
              onRemoveDir={onRemoveDir}
            />
          )}

          {phase.kind === 'scope' && (
            <ScopeView
              candidates={scopeCandidates}
              selectedIndex={safeSelectedIndex}
              onHover={onSetSelectedIndex}
              onClick={(s) => onScopeFill(s)}
              partial={phase.partial}
              itemRefs={itemRefs}
            />
          )}

          {phase.kind === 'path' && (
            <PathView
              candidates={pathCandidates}
              selectedIndex={safeSelectedIndex}
              onHover={onSetSelectedIndex}
              onNavigate={(name, isDir) => onPathNavigate(joinPath(phase.parent, name, isDir))}
              onCommit={(name) => {
                const full = (absolutePath.endsWith('/') ? absolutePath : absolutePath + '/') + name
                onPathCommit(full, phase.scope)
              }}
              itemRefs={itemRefs}
            />
          )}
        </div>

        <div className="border-t border-border px-2 py-1 text-xs text-muted-foreground shrink-0">
          {phase.kind === 'overview' && (
            <>continue typing <Kbd>project</Kbd> or <Kbd>session</Kbd></>
          )}
          {phase.kind === 'scope' && (
            <>
              <Kbd>tab</Kbd> fill scope
              <span className="mx-1.5">&middot;</span>
              <Kbd>↑↓</Kbd> navigate
              <span className="mx-1.5">&middot;</span>
              <Kbd>esc</Kbd> close
            </>
          )}
          {phase.kind === 'path' && (
            <>
              <Kbd>tab</Kbd> navigate
              <span className="mx-1.5">&middot;</span>
              <Kbd>↵</Kbd> add
              <span className="mx-1.5">&middot;</span>
              <Kbd>↑↓</Kbd> select
              <span className="mx-1.5">&middot;</span>
              <Kbd>esc</Kbd> close
            </>
          )}
        </div>
      </div>
    )
  }
)

function OverviewView({
  user,
  projectShared,
  projectLocal,
  session,
  onAddViaPicker,
  onRemoveDir,
}: {
  user: string[]
  projectShared: string[]
  projectLocal: string[]
  session: string[]
  onAddViaPicker: (scope: 'project' | 'session') => void
  onRemoveDir: (path: string, scope: 'project' | 'session') => void
}) {
  const hasUser = user.length > 0
  const projectEmpty = projectShared.length === 0 && projectLocal.length === 0
  const sessionEmpty = session.length === 0

  return (
    <div className="px-2 py-1 space-y-2">
      {hasUser && (
        <DirGroup label="USER">
          {user.map((d) => (
            <DirRow key={`user:${d}`} dir={d} />
          ))}
        </DirGroup>
      )}
      <DirGroup label="PROJECT" empty={projectEmpty} onAdd={() => onAddViaPicker('project')}>
        {projectShared.map((d) => (
          <DirRow key={`shared:${d}`} dir={d} />
        ))}
        {projectLocal.map((d) => (
          <DirRow key={`local:${d}`} dir={d} onRemove={() => onRemoveDir(d, 'project')} />
        ))}
      </DirGroup>
      <DirGroup label="SESSION" empty={sessionEmpty} onAdd={() => onAddViaPicker('session')}>
        {session.map((d) => (
          <DirRow key={`session:${d}`} dir={d} onRemove={() => onRemoveDir(d, 'session')} />
        ))}
      </DirGroup>
    </div>
  )
}

function DirGroup({ label, empty, onAdd, children }: { label: string; empty?: boolean; onAdd?: () => void; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 flex items-center gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        {onAdd && (
          <button
            onMouseDown={(e) => { e.preventDefault(); onAdd() }}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={`Add ${label.toLowerCase()} directory`}
          >
            <FolderPlus className="size-3" />
          </button>
        )}
      </div>
      {empty ? (
        <div className="px-1.5 text-xs italic text-muted-foreground/60">none</div>
      ) : (
        <div className="space-y-0.5">{children}</div>
      )}
    </div>
  )
}

function DirRow({ dir, onRemove }: { dir: string; onRemove?: () => void }) {
  return (
    <div className="group flex items-center justify-between gap-2 rounded py-0.5 text-xs hover:bg-accent/30">
      <div className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5">
        <Folder className="size-3 shrink-0 text-blue-500" />
        <span className="font-medium text-foreground">{basename(dir)}</span>
        {onRemove && (
          <button
            onMouseDown={(ev) => { ev.preventDefault(); onRemove() }}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            title="Remove"
          >
            <X className="size-2.5" />
          </button>
        )}
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-right font-mono text-xs text-muted-foreground/70 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {dir}
      </div>
    </div>
  )
}

function basename(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, '')
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] || p
}

function ScopeView({
  candidates,
  selectedIndex,
  onHover,
  onClick,
  partial,
  itemRefs,
}: {
  candidates: ScopeCandidate[]
  selectedIndex: number
  onHover: (i: number) => void
  onClick: (s: Scope) => void
  partial: string
  itemRefs: React.MutableRefObject<Map<number, HTMLButtonElement>>
}) {
  if (candidates.length === 0) {
    return (
      <div className="px-2 py-1.5 text-xs text-muted-foreground">
        Type <span className="font-mono text-foreground">project</span> or{' '}
        <span className="font-mono text-foreground">session</span> (got "{partial}")
      </div>
    )
  }
  return (
    <>
      {candidates.map((c, i) => (
        <button
          key={c.scope}
          ref={(el) => {
            if (el) itemRefs.current.set(i, el)
            else itemRefs.current.delete(i)
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onClick(c.scope)}
          onMouseEnter={() => onHover(i)}
          className={cn(
            'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
            i === selectedIndex ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50'
          )}
        >
          <span className="font-medium">
            <HighlightedText text={c.scope} indices={c.matchIndices} className="" />
          </span>
          <span className="text-xs text-muted-foreground">
            {c.scope === 'project' ? 'persisted in this project' : 'this session only'}
          </span>
        </button>
      ))}
    </>
  )
}

function PathView({
  candidates,
  selectedIndex,
  onHover,
  onNavigate,
  onCommit,
  itemRefs,
}: {
  candidates: PathCandidate[]
  selectedIndex: number
  onHover: (i: number) => void
  onNavigate: (name: string, isDir: boolean) => void
  onCommit: (name: string) => void
  itemRefs: React.MutableRefObject<Map<number, HTMLButtonElement>>
}) {
  return (
    <>
      {candidates.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">No matching subdirectories</div>
      ) : (
        candidates.map((c, i) => (
          <button
            key={c.entry.name}
            ref={(el) => {
              if (el) itemRefs.current.set(i, el)
              else itemRefs.current.delete(i)
            }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (c.entry.isDirectory ? onNavigate(c.entry.name, true) : onCommit(c.entry.name))}
            onMouseEnter={() => onHover(i)}
            className={cn(
              'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
              i === selectedIndex ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50'
            )}
          >
            <Folder className="size-3.5 shrink-0 text-blue-500" />
            <HighlightedText text={c.entry.name} indices={c.matchIndices} className="truncate" />
          </button>
        ))
      )}
    </>
  )
}
