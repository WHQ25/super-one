import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { ACTIVE_SESSION_PAGE_SIZE, listSessionsPage } from '@/lib/session-list-ops'
import { useChatStore } from '@/stores/chat'
import { noteListedUnread } from '@/stores/chat-store/helpers/unseen-completed'

export interface FocusChildProject {
  path: string
  projectId: string
  connected: boolean
}
interface ChildPage {
  sessions: SessionHistoryEntry[]
  hasMore: boolean
  loading?: boolean
  error?: boolean
}

/** Focus can span projects and hosts; these pages must not be pruned as project roots. */
export function useFocusSessionChildren(
  parentSessionId: string,
  projects: FocusChildProject[],
  initial: Record<string, ChildPage>,
) {
  const [pages, setPages] = useState(initial)
  const pagesRef = useRef(pages)
  const projectsRef = useRef(projects)
  projectsRef.current = projects
  const generation = useRef(new Map<string, number>())
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const publish = useCallback((path: string, page: ChildPage) => {
    const next = { ...pagesRef.current, [path]: page }
    pagesRef.current = next
    setPages(next)
  }, [])
  const load = useCallback(async (project: FocusChildProject, append = false) => {
    if (!project.connected) return
    const current = pagesRef.current[project.path]
    if (append && (!current?.hasMore || current.loading)) return
    const version = (generation.current.get(project.path) ?? 0) + 1
    generation.current.set(project.path, version)
    const existing = current?.sessions ?? []
    publish(project.path, { sessions: existing, hasMore: current?.hasMore ?? false, loading: true })
    const sessions = append ? existing.slice() : []
    const wanted = append ? existing.length + ACTIVE_SESSION_PAGE_SIZE : Math.max(ACTIVE_SESSION_PAGE_SIZE, existing.length)
    const valid = () => mounted.current && generation.current.get(project.path) === version
      && projectsRef.current.some((item) => item.path === project.path && item.connected)
    try {
      let hasMore = true
      while (sessions.length < wanted && hasMore) {
        const page = await listSessionsPage(project.path, {
          projectId: project.projectId, parentSessionId,
          limit: ACTIVE_SESSION_PAGE_SIZE, offset: sessions.length,
        })
        if (!valid()) return
        sessions.push(...page)
        hasMore = page.length >= ACTIVE_SESSION_PAGE_SIZE
      }
      if (!valid()) return
      const seen = new Set<string>()
      const unique = sessions.filter((row) => {
        if (seen.has(row.sessionId)) return false
        seen.add(row.sessionId)
        return true
      })
      publish(project.path, { sessions: unique, hasMore })
      const unread = unique.filter((row) => row.unread).map((row) => ({ folderPath: project.path, sessionId: row.sessionId }))
      if (unread.length) useChatStore.setState((state) => noteListedUnread(state, unread))
    } catch {
      if (valid()) publish(project.path, { sessions: existing, hasMore: current?.hasMore ?? false, error: true })
    }
  }, [parentSessionId, publish])
  const onlinePaths = useRef(new Set(projects.filter((project) => project.connected).map((project) => project.path)))
  useEffect(() => {
    for (const project of projects) {
      if (project.connected && (!pagesRef.current[project.path] || !onlinePaths.current.has(project.path))) void load(project)
      if (!project.connected) generation.current.set(project.path, (generation.current.get(project.path) ?? 0) + 1)
    }
    onlinePaths.current = new Set(projects.filter((project) => project.connected).map((project) => project.path))
  }, [projects, load])
  useEffect(() => window.app.onSessionChanged((path) => {
    for (const project of projectsRef.current) {
      if (!path || path === project.path) void load(project)
    }
  }), [load])
  return { pages, load }
}
