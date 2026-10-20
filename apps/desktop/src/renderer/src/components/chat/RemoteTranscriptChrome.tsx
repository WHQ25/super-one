import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { EdgeLoader } from '@superone/chat-view/EdgeLoader'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { pageRemoteTranscript } from '@/lib/remote-session-ops'
import { useChatStore, useSessionScope } from '@/stores/chat'
import { patchRemoteSession, setTranscriptFlag } from '@/stores/chat-store/helpers/remote-reconnect'
import { planHistoryEdges, scrollParent } from './remote-transcript-edges'

/** Which end of the transcript this chrome belongs to. */
export type RemoteTranscriptEdge = 'top' | 'bottom'

export interface RemoteTranscriptChromeViewProps {
  edge?: RemoteTranscriptEdge
  loading?: boolean
  hasMore?: boolean
  sentinelRef?: RefObject<HTMLDivElement | null>
}

/**
 * The remote transcript's edge. Older and newer pages load when the reader
 * reaches them, the same way the phone does. While a page or a resync is in
 * flight this is only the phone's loader. Idle and failed pages render the
 * sentinel alone; another visit retries.
 */
export function RemoteTranscriptChromeView({
  edge = 'top',
  loading = false,
  hasMore = false,
  sentinelRef,
}: RemoteTranscriptChromeViewProps) {
  if (!loading && !hasMore) return null
  return (
    <div
      ref={sentinelRef}
      data-testid={`remote-transcript-chrome-${edge}`}
      className="flex min-h-px flex-col"
    >
      {loading ? <EdgeLoader edge={edge} loading /> : null}
    </div>
  )
}

interface RemoteTranscriptEdgeApi {
  topRef: RefObject<HTMLDivElement | null>
  bottomRef: RefObject<HTMLDivElement | null>
  loadingTop: boolean
  loadingBottom: boolean
  hasOlder: boolean
  hasNewer: boolean
}

const RemoteTranscriptEdgeContext = createContext<RemoteTranscriptEdgeApi | null>(null)

function anchorKey(anchor: { messageId: string; key?: string } | null | undefined): string | null {
  if (!anchor) return null
  return anchor.key ? `${anchor.messageId}\0${anchor.key}` : anchor.messageId
}

/**
 * Pages a remote transcript when either edge comes within a screen of the
 * scrollport. Local sessions and a legacy full load have no edges.
 */
export function RemoteTranscriptEdges({ children }: { children: ReactNode }) {
  const scope = useSessionScope()
  const topRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [pagingEdge, setPagingEdge] = useState<'top' | 'bottom' | null>(null)
  const pagingEdgeRef = useRef<'top' | 'bottom' | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const model = useChatStore(useShallow((s) => {
    const projectPath = scope?.projectPath ?? s.activeProject
    const remote = projectPath ? parseRemoteProjectKey(projectPath) : null
    if (!remote || !projectPath) return null
    const sessionId = scope?.sessionId ?? s.projectSessions[projectPath]?._activeSessionId ?? null
    if (!sessionId) return null
    const session = s.projectSessions[projectPath]?._sessions[sessionId]
    const window = session?.transcriptWindow ?? null
    const resyncing = session?.transcriptResyncing === true
    if (!window && !resyncing) return null
    return {
      projectPath,
      sessionId,
      older: anchorKey(window?.older),
      newer: anchorKey(window?.newer),
      resyncing,
      paging: session?.transcriptPaging === true,
    }
  }))
  const epoch = model ? `${model.projectPath}\0${model.sessionId}` : ''
  const busy = model?.paging === true || model?.resyncing === true || pagingEdge !== null

  const page = useCallback((direction: 'before' | 'after'): boolean => {
    if (!model || pagingEdgeRef.current) return false
    const { projectPath, sessionId } = model
    const current = useChatStore.getState().projectSessions[projectPath]?._sessions[sessionId]
    const anchor = direction === 'before' ? current?.transcriptWindow?.older : current?.transcriptWindow?.newer
    if (!current || !anchor || current.transcriptPaging || current.transcriptResyncing) return false
    const edge = direction === 'before' ? 'top' : 'bottom'
    pagingEdgeRef.current = edge
    setPagingEdge(edge)
    setTranscriptFlag(projectPath, sessionId, 'transcriptPaging', true, useChatStore.setState)
    void pageRemoteTranscript(projectPath, sessionId, current, { anchor, direction })
      .then((paged) => {
        if (paged) {
          patchRemoteSession(projectPath, sessionId, (session) => ({
            ...session,
            ...paged,
            transcriptPaging: false,
          }), useChatStore.setState)
        } else {
          setTranscriptFlag(projectPath, sessionId, 'transcriptPaging', false, useChatStore.setState)
        }
      })
      .catch((error) => {
        console.warn('[chat] transcript page failed:', error)
        setTranscriptFlag(projectPath, sessionId, 'transcriptPaging', false, useChatStore.setState)
      })
      .finally(() => {
        pagingEdgeRef.current = null
        if (mounted.current) setPagingEdge(null)
      })
    return true
  }, [model])

  const attempted = useRef<{ epoch: string; older?: string; newer?: string }>({ epoch })
  const older = model?.older ?? null
  const newer = model?.newer ?? null
  const loadPage = useEffectEvent((direction: 'before' | 'after') => page(direction))

  useEffect(() => {
    if (attempted.current.epoch !== epoch) attempted.current = { epoch }
    const anchor = topRef.current ?? bottomRef.current
    const root = anchor ? scrollParent(anchor) : null
    let timer: ReturnType<typeof setTimeout> | undefined
    const observers: IntersectionObserver[] = []
    let resize: ResizeObserver | undefined
    if (root) {
      const check = () => {
        if (busy || pagingEdgeRef.current) return
        const box = (element: HTMLElement | null) => {
          if (!element) return null
          const rect = element.getBoundingClientRect()
          return { top: rect.top, bottom: rect.bottom }
        }
        const rootRect = root.getBoundingClientRect()
        const plan = planHistoryEdges({
          root: { top: rootRect.top, bottom: rootRect.bottom },
          top: box(topRef.current),
          bottom: box(bottomRef.current),
          older,
          newer,
          attempted: attempted.current,
        })
        for (const edge of plan.drop) delete attempted.current[edge]
        if (!plan.load) return
        const key = plan.load === 'older' ? older : newer
        if (!key || !loadPage(plan.load === 'older' ? 'before' : 'after')) return
        attempted.current[plan.load] = key
      }
      const schedule = () => { clearTimeout(timer); timer = setTimeout(check, 80) }
      observers.push(
        new IntersectionObserver(schedule, { root, rootMargin: '100% 0px' }),
        new IntersectionObserver(schedule, { root }),
      )
      for (const observer of observers) {
        if (topRef.current) observer.observe(topRef.current)
        if (bottomRef.current) observer.observe(bottomRef.current)
      }
      resize = new ResizeObserver(schedule)
      resize.observe(root)
      schedule()
    }
    return () => {
      clearTimeout(timer)
      resize?.disconnect()
      for (const observer of observers) observer.disconnect()
    }
  }, [epoch, older, newer, busy])

  const api = useMemo((): RemoteTranscriptEdgeApi => ({
    topRef,
    bottomRef,
    loadingTop: pagingEdge === 'top' || model?.resyncing === true,
    loadingBottom: pagingEdge === 'bottom',
    hasOlder: older != null,
    hasNewer: newer != null,
  }), [pagingEdge, model?.resyncing, older, newer])
  return <RemoteTranscriptEdgeContext.Provider value={api}>{children}</RemoteTranscriptEdgeContext.Provider>
}

/** Store-backed window chrome. One instance per transcript edge. */
export function RemoteTranscriptChrome({ edge = 'top' }: { edge?: RemoteTranscriptEdge }) {
  const api = useContext(RemoteTranscriptEdgeContext)
  if (!api) return null
  const hasMore = edge === 'top' ? api.hasOlder : api.hasNewer
  const loading = edge === 'top' ? api.loadingTop : api.loadingBottom
  if (!hasMore && !loading) return null
  return (
    <RemoteTranscriptChromeView
      edge={edge}
      loading={loading}
      hasMore={hasMore}
      sentinelRef={edge === 'top' ? api.topRef : api.bottomRef}
    />
  )
}
