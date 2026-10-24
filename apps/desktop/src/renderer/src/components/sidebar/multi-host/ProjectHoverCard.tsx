import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, GitBranch, Loader2, MessageSquare, Pencil } from 'lucide-react'
import { GithubIcon } from '@superone/ui/components/ui/github-icon'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { listAllSessions } from '@/lib/session-list-ops'
import { requestOpenExternalLink } from '@/lib/external-link'
import {
  projectRepoLink,
  repoIdentityFor,
  type ProjectHoverFolder,
  type ProjectRepoLink,
} from '@/lib/multi-host/project-hover'
import { SessionHoverCardTrigger, SidebarHoverCard } from './SessionHoverCard'

const sessionTotals = new Map<string, number>()

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

function useSessionTotal(paths: readonly string[], known: number | null, offline: boolean): number | null {
  const key = paths.join('\n')
  const pathsRef = useRef(paths)
  pathsRef.current = paths
  const [fetched, setFetched] = useState<number | null>(null)
  useEffect(() => {
    const current = pathsRef.current
    if (known != null || offline || current.length === 0) return
    let cancelled = false
    if (current.every((path) => sessionTotals.has(path))) {
      setFetched(current.reduce((sum, path) => sum + (sessionTotals.get(path) ?? 0), 0))
      return
    }
    void Promise.all(current.map(async (path) => {
      const cached = sessionTotals.get(path)
      if (cached != null) return cached
      const rows = await listAllSessions(path)
      const count = rows.reduce((sum, session) => sum + (session.isHidden ? 0 : 1), 0)
      sessionTotals.set(path, count)
      return count
    })).then((counts) => {
      if (!cancelled) setFetched(counts.reduce((sum, count) => sum + count, 0))
    }).catch(() => {
      if (!cancelled) setFetched(null)
    })
    return () => { cancelled = true }
  }, [known, offline, key])
  return known ?? fetched
}

export function ProjectHoverBody({
  name,
  repoIdentity,
  repoLookup = null,
  folders,
  sessionCount,
  sessionPaths,
  offline = false,
  onEdit,
  edits,
}: {
  name: string
  /** `undefined` asks the environment. `null` means this checkout has no origin. */
  repoIdentity?: string | null
  repoLookup?: { connectionId: string; projectId: string; hostPath: string } | null
  folders: ProjectHoverFolder[]
  sessionCount: number | null
  sessionPaths: readonly string[]
  offline?: boolean
  /** One checkout: the same action as the row's Edit Project item. */
  onEdit?: () => void
  /** Several checkouts: the same targets as the Edit Project submenu. */
  edits?: { id: string; label: string; onSelect: () => void }[]
}) {
  const { t } = useTranslation()
  const repo = useRepoLink(repoIdentity, repoLookup)
  const total = useSessionTotal(sessionPaths, sessionCount, offline)
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
        <div key={folder.path} className="flex items-center gap-1.5 text-muted-foreground" title={folder.title}>
          <Folder className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{folder.name}</span>
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
