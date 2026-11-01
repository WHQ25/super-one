import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, FolderOpen, GitBranch, Loader2, MessageSquare, Pencil } from 'lucide-react'
import { GithubIcon } from '@superone/ui/components/ui/github-icon'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { listAllSessions } from '@/lib/session-list-ops'
import { requestOpenExternalLink } from '@/lib/external-link'
import {
  countProjectSessions,
  projectRepoLink,
  repoIdentityFor,
  type ProjectHoverFolder,
  type ProjectRepoLink,
} from '@/lib/multi-host/project-hover'
import { SessionHoverCardTrigger, SidebarHoverCard } from './SessionHoverCard'

const sessionTotals = new Map<string, number>()

function cachedSessionTotal(paths: readonly string[]): number | null {
  if (paths.length === 0 || paths.some((path) => !sessionTotals.has(path))) return null
  return paths.reduce((sum, path) => sum + (sessionTotals.get(path) ?? 0), 0)
}

/** Tests start from an empty total. */
export function resetProjectHoverSessionTotals(): void {
  sessionTotals.clear()
}

function useRepoLink(
  repoIdentity: string | null | undefined,
  lookup: { connectionId: string; projectId: string; hostPath: string } | null,
): ProjectRepoLink | null {
  const [resolved, setResolved] = useState<string | null | undefined>(repoIdentity)
  useEffect(() => {
    if (repoIdentity !== undefined) {
      setResolved(repoIdentity)
      return
    }
    if (!lookup) {
      setResolved(null)
      return
    }
    let cancelled = false
    void repoIdentityFor(lookup.connectionId, lookup.projectId, lookup.hostPath, (connectionId) => (
      window.environment.listProjects(connectionId)
    )).then((identity) => {
      if (!cancelled) setResolved(identity)
    })
    return () => { cancelled = true }
  }, [repoIdentity, lookup?.connectionId, lookup?.projectId, lookup?.hostPath])
  return projectRepoLink(resolved)
}

/**
 * Total sessions for these project keys.
 *
 * The sidebar list is only the active page, so a number taken from it leaves
 * out settled sessions and anything not loaded yet. This reads the whole
 * project, including settled sessions and spawn children.
 */
function useSessionTotal(paths: readonly string[], offline: boolean): number | null {
  const key = paths.join('\n')
  const pathsRef = useRef(paths)
  pathsRef.current = paths
  const [fetched, setFetched] = useState<number | null>(() => cachedSessionTotal(paths))
  useEffect(() => {
    const current = pathsRef.current
    if (offline || current.length === 0) return
    let cancelled = false
    let ticket = 0
    const load = () => {
      const mine = ++ticket
      void Promise.all(current.map(async (path) => {
        const rows = await listAllSessions(path, { includeSettled: true })
        const count = countProjectSessions(rows)
        sessionTotals.set(path, count)
        return count
      })).then((counts) => {
        if (cancelled || mine !== ticket) return
        setFetched(counts.reduce((sum, count) => sum + count, 0))
      }).catch(() => {
        if (cancelled || mine !== ticket) return
        if (cachedSessionTotal(current) == null) setFetched(null)
      })
    }
    setFetched(cachedSessionTotal(current))
    load()
    return () => { cancelled = true }
  }, [offline, key])
  return fetched
}

export function ProjectHoverBody({
  name,
  repoIdentity,
  repoLookup = null,
  folders,
  sessionCount = null,
  sessionPaths,
  offline = false,
  onEdit,
  edits,
  onOpenFolder,
}: {
  name: string
  /** `undefined` asks the environment. `null` means this checkout has no origin. */
  repoIdentity?: string | null
  repoLookup?: { connectionId: string; projectId: string; hostPath: string } | null
  folders: ProjectHoverFolder[]
  /** Shown when `sessionPaths` is empty. A real project loads its own total. */
  sessionCount?: number | null
  sessionPaths: readonly string[]
  offline?: boolean
  /** One checkout: the same action as the row's Edit Project item. */
  onEdit?: () => void
  /** Several checkouts: the same targets as the Edit Project submenu. */
  edits?: { id: string; label: string; onSelect: () => void }[]
  /** Defaults to revealing the folder on this machine. */
  onOpenFolder?: (path: string) => void
}) {
  const { t } = useTranslation()
  const repo = useRepoLink(repoIdentity, repoLookup)
  const fetched = useSessionTotal(sessionPaths, offline)
  // An empty path list is a story or a row with nothing to ask. Production
  // passes the project keys and ignores any sidebar page count.
  const total = sessionPaths.length > 0 && !offline ? fetched : sessionCount
  return (
    <div className="flex flex-col gap-2 text-xs" data-project-hover>
      <div className="flex items-start gap-2">
        <div className="line-clamp-3 min-w-0 flex-1 break-words text-sm font-medium text-popover-foreground">{name}</div>
        {onEdit && !edits?.length && (
          <IconButton size="sm" tooltip={t('sidebar.contextMenu.editProject')} onClick={onEdit}>
            <Pencil />
          </IconButton>
        )}
      </div>
      {edits && edits.length > 0 && (
        <div className="flex flex-col">
          {edits.map((edit) => (
            <button
              key={edit.id}
              type="button"
              className="flex items-center gap-1.5 rounded px-0.5 py-0.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={edit.onSelect}
            >
              <Pencil className="size-3 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{edit.label}</span>
            </button>
          ))}
        </div>
      )}
      {repo && (
        <button
          type="button"
          className="flex min-w-0 items-center gap-1 text-left text-muted-foreground hover:text-foreground"
          title={repo.href}
          onClick={() => requestOpenExternalLink(repo.href)}
        >
          {repo.github
            ? <GithubIcon className="size-3 shrink-0" />
            : <GitBranch className="size-3 shrink-0" />}
          <span className="min-w-0 flex-1 truncate">{repo.label}</span>
        </button>
      )}
      {folders.map((folder) => (
        <div key={folder.path} className="group/folder relative flex min-w-0 items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground focus-within:text-foreground">
          <Folder className="size-3 shrink-0" />
          <span
            className={cn('min-w-0 flex-1 truncate', folder.openable && 'group-hover/folder:pr-5 group-focus-within/folder:pr-5')}
            title={folder.title}
          >
            {folder.name}
          </span>
          {folder.openable && (
            <IconButton
              size="xs"
              variant="ghost"
              tooltip={t('sidebar.contextMenu.openFolder')}
              className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 pointer-events-none group-hover/folder:pointer-events-auto group-hover/folder:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
              onClick={(event) => {
                event.stopPropagation()
                if (onOpenFolder) onOpenFolder(folder.path)
                else void window.app.showInFolder(folder.path, '')
              }}
            >
              <FolderOpen />
            </IconButton>
          )}
        </div>
      ))}
      {(total != null || !offline) && (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <MessageSquare className="size-3 shrink-0" />
          {total == null
            ? <Loader2 aria-hidden className="size-3 animate-spin" />
            : <span>{t('sidebar.projectHover.sessions', { count: total })}</span>}
        </div>
      )}
    </div>
  )
}

export function ProjectHoverCard({
  open,
  children,
  ...body
}: {
  open?: boolean
  children: ReactNode
} & Parameters<typeof ProjectHoverBody>[0]) {
  return (
    <SidebarHoverCard open={open} content={<ProjectHoverBody {...body} />}>
      {children}
    </SidebarHoverCard>
  )
}

export { SessionHoverCardTrigger }
