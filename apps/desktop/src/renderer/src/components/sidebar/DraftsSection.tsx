import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Clock, PencilLine, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DraftListEntry } from '@superone/shared/environment'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { resumeDraft } from '@/lib/draft-resume'
import { useDraftsStore } from '@/stores/drafts'
import { useChatStore } from '@/stores/chat-store'
import { discardDeletedDraft, getDraftIdForSession } from '@/stores/chat-store/helpers/draft-promote'
import { nextDraftSlots, selectVisibleDrafts } from './draft-visibility'

interface DraftsSectionProps {
  /** Environment whose drafts are shown — drafts follow the sidebar's host. */
  connectionId: string
}

/**
 * Row height, and the sole source of truth for the group's geometry. Rows are
 * uniform, so slot `n` sits at `n * DRAFT_ROW_HEIGHT` and the group is
 * `slots.length * DRAFT_ROW_HEIGHT` tall — no measurement anywhere.
 */
const DRAFT_ROW_HEIGHT = 36

/** Opening/closing the space the rows occupy — only runs when the count changes. */
const GROUP_HEIGHT_TRANSITION = { duration: 0.18, ease: [0.32, 0.72, 0, 1] } as const
/** The row itself flying in from the right, just behind the space opening up. */
const SLIDE_IN_TRANSITION = { duration: 0.22, delay: 0.06, ease: [0.22, 1, 0.36, 1] } as const
/** Leaving for the composer — accelerating out, so it reads as departing. */
const SLIDE_OUT_TRANSITION = { duration: 0.2, ease: [0.55, 0, 1, 0.45] } as const
/**
 * `x` carries the fly in/out, `y` carries the slot. Both are transform channels
 * motion composes into one transform, so sliding between slots never fights the
 * horizontal flight the way a flow-based layout animation would.
 */
const ROW_TRANSITION = {
  x: SLIDE_IN_TRANSITION,
  opacity: SLIDE_IN_TRANSITION,
  y: GROUP_HEIGHT_TRANSITION,
} as const

const DraftRow = memo(function DraftRow({
  draft,
  connectionId,
  slotY,
  onResume,
}: {
  draft: DraftListEntry
  connectionId: string
  /** Where this row sits, so a resume can leave a copy flying out of that slot. */
  slotY?: number
  onResume?: (draft: DraftListEntry, slotY: number) => void
}) {
  const { t } = useTranslation()
  const discardDraft = useDraftsStore((s) => s.discardDraft)

  const resume = () => {
    onResume?.(draft, slotY ?? 0)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={resume}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          resume()
        }
      }}
      style={{ height: DRAFT_ROW_HEIGHT }}
      className="group/draft flex cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2.5 transition-colors hover:bg-sidebar-hover"
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
        onClick={(e) => {
          e.stopPropagation()
          discardDeletedDraft(draft.id)
          void discardDraft(connectionId, draft.id)
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
  const resumingDraftId = useDraftsStore((s) => s.resumingDraftId)
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

  // The clicked row leaves the list immediately (its content is heading for the
  // composer), so keep a copy pinned at the slot it occupied and fly that out
  // while the rows below slide up into the gap.
  const [flyOut, setFlyOut] = useState<{ draft: DraftListEntry; slotY: number } | null>(null)
  const handleResume = useCallback(
    (draft: DraftListEntry, slotY: number) => {
      setFlyOut({ draft, slotY })
      void resumeDraft(connectionId, draft)
    },
    [connectionId],
  )

  // Rows present in the very first painted list are already "there" — only ones
  // that arrive later fly in.
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
  }, [])

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

  const visibleDrafts = useMemo(
    () => selectVisibleDrafts(drafts, { activeSessionId, activeDraftId, resumingDraftId }),
    [drafts, activeSessionId, activeDraftId, activeProject, resumingDraftId],
  )

  // Slots drive both what moves and how much space the group holds. Adjusting
  // state during render is the supported way to derive from a prior value;
  // React re-runs the render before committing.
  const visibleIds = useMemo(() => visibleDrafts.map((d) => d.id), [visibleDrafts])
  const [slots, setSlots] = useState(visibleIds)
  const nextSlots = nextDraftSlots(slots, visibleIds, !!resumingDraftId)
  if (nextSlots.length !== slots.length || nextSlots.some((id, i) => id !== slots[i])) {
    setSlots(nextSlots)
  }

  // `initial={false}` keeps drafts already present at mount from animating open.
  return (
    <motion.div
      className="relative overflow-hidden"
      initial={false}
      animate={{ height: slots.length * DRAFT_ROW_HEIGHT }}
      transition={GROUP_HEIGHT_TRANSITION}
    >
      {visibleDrafts.map((draft) => {
        const slotY = Math.max(0, slots.indexOf(draft.id)) * DRAFT_ROW_HEIGHT
        return (
          <motion.div
            key={draft.id}
            className="absolute inset-x-0 top-0"
            initial={mountedRef.current ? { x: '105%', y: slotY, opacity: 0 } : false}
            animate={{ x: 0, y: slotY, opacity: 1 }}
            transition={ROW_TRANSITION}
          >
            <DraftRow
              draft={draft}
              connectionId={connectionId}
              slotY={slotY}
              onResume={handleResume}
            />
          </motion.div>
        )
      })}
      {flyOut && (
        <motion.div
          key={flyOut.draft.id}
          className="pointer-events-none absolute inset-x-0 top-0"
          initial={{ x: 0, y: flyOut.slotY, opacity: 1 }}
          animate={{ x: '105%', y: flyOut.slotY, opacity: 0 }}
          transition={SLIDE_OUT_TRANSITION}
          onAnimationComplete={() => setFlyOut(null)}
        >
          <DraftRow draft={flyOut.draft} connectionId={connectionId} />
        </motion.div>
      )}
    </motion.div>
  )
})
