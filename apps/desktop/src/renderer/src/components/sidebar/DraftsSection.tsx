import { memo, useEffect, useMemo } from 'react'
import { Clock, PencilLine, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DraftListEntry } from '@superone/shared/environment'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { resumeDraft } from '@/lib/draft-resume'
import { useDraftsStore } from '@/stores/drafts'
import { useChatStore } from '@/stores/chat-store'
import {
  getDraftIdForSession,
  isDraftOwnedBySession,
} from '@/stores/chat-store/helpers/draft-promote'

interface DraftsSectionProps {
  /** Environment whose drafts are shown — drafts follow the sidebar's host. */
  connectionId: string
}

const DraftRow = memo(function DraftRow({
  draft,
  connectionId,
}: {
  draft: DraftListEntry
  connectionId: string
}) {
  const { t } = useTranslation()
  const removeDraft = useDraftsStore((s) => s.removeDraft)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        void resumeDraft(connectionId, draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          void resumeDraft(connectionId, draft)
        }
      }}
      className="group/draft flex h-9 cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2.5 transition-colors hover:bg-sidebar-accent/80"
    >
      <PencilLine className="size-3.5 shrink-0 text-sidebar-foreground/45" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-md text-sidebar-foreground">
        {draft.title || draft.text.trim() || t('sidebar.drafts.untitled')}
      </span>
      {draft.pendingSync && (
        <span title={t('sidebar.drafts.pendingSyncHint')} className="shrink-0 text-warning">
          <Clock className="size-3" aria-label={t('sidebar.drafts.pendingSync')} />
        </span>
      )}
      <IconButton
        size="xs"
        variant="nested"
        tooltip={t('common.delete')}
        aria-label={t('common.delete')}
        onClick={(e) => {
          e.stopPropagation()
          void removeDraft(connectionId, draft.id)
        }}
        className="opacity-0 transition-opacity group-hover/draft:opacity-100"
      >
        <Trash2 />
      </IconButton>
    </div>
  )
})

/**
 * Flat draft rows for the selected host — peers of project rows (no section
 * header). Empty host → nothing rendered.
 */
export const DraftsSection = memo(function DraftsSection({
  connectionId,
}: DraftsSectionProps) {
  // Select the stored array (or undefined). Do not coerce to `[]` inside the
  // selector — a fresh empty array every snapshot loops useSyncExternalStore.
  const drafts = useDraftsStore((s) => s.byConnection[connectionId])
  const loadDrafts = useDraftsStore((s) => s.loadDrafts)
  const activeProject = useChatStore((s) => s.activeProject)
  const activeSessionId = useChatStore((s) =>
    s.activeProject ? s.projectSessions[s.activeProject]?._activeSessionId ?? null : null,
  )
  const activeDraftId = useChatStore((s) => {
    const path = s.activeProject
    const sid = path ? s.projectSessions[path]?._activeSessionId : null
    if (!path || !sid) return null
    return s.projectSessions[path]?._sessions[sid]?.draftId
      ?? getDraftIdForSession(sid)
      ?? null
  })

  useEffect(() => {
    void loadDrafts(connectionId)
    if (connectionId === 'local') return
    // Outbox drains on reconnect; refresh so pendingSync badges clear and
    // drafts that lived only on the node appear once it is reachable again.
    const unsub = window.environment.onStatusEvent?.((snapshot) => {
      if (snapshot.connectionId === connectionId && snapshot.state === 'connected') {
        void loadDrafts(connectionId)
      }
    })
    return typeof unsub === 'function' ? unsub : undefined
  }, [connectionId, loadDrafts])

  // Hide the draft for the still-focused origin session (visibility/quit flush
  // persists it for durability, but showing it invites a clobbering re-open).
  const visibleDrafts = useMemo(() => {
    if (!drafts?.length) return []
    return drafts.filter(
      (d) => !isDraftOwnedBySession(d, activeSessionId, activeDraftId),
    )
  }, [drafts, activeSessionId, activeDraftId, activeProject])

  if (!visibleDrafts.length) return null

  return (
    <>
      {visibleDrafts.map((draft) => (
        <DraftRow key={draft.id} draft={draft} connectionId={connectionId} />
      ))}
    </>
  )
})
