import { useEffect, useRef, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated'
import { Clock, PencilLine, Trash2 } from 'lucide-react-native'
import type { DraftListEntry } from '@superone/shared/environment/draft-rpc'
import { hasPersistableDraftContent } from '@superone/shared/environment/draft-content'
import { Text } from '../ui/text'
import { SwipeRow } from '../ui/swipe-row'
import { WorkspaceSectionHeading } from '../ui/workspace-section-heading'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'
import { useIconMotion } from '../ui/use-icon-motion'
import { DRAFT_SLOT_HOLE, nextDraftSlots } from './draft-slots'
import {
  DRAFT_FLIGHT_SCALE,
  DRAFT_GROUP_EASING,
  DRAFT_GROUP_MS,
  DRAFT_ROW_HEIGHT,
  DRAFT_SLIDE_IN_DELAY_MS,
  DRAFT_SLIDE_IN_EASING,
  DRAFT_SLIDE_IN_MS,
  DRAFT_SLIDE_OUT_EASING,
  DRAFT_SLIDE_OUT_MS,
} from './draft-motion'

export type WorkspaceDraftsProps = {
  drafts: DraftListEntry[]
  activeDraftId?: string | null
  /** Controlled fold. Omit to keep the choice in this mount. Starts open. */
  collapsed?: boolean
  onToggleCollapsed?: () => void
  onOpenDraft(draft: DraftListEntry): void | Promise<unknown>
  onDeleteDraft(draft: DraftListEntry): void
}

/**
 * Parked drafts, as their own group above Projects.
 *
 * Drafts already on screen when this mounts stay put. One that arrives later
 * — leaving the composer on a sidebar that stays up — flies in from the right.
 * Opening one flies that row out while the rows below keep their slots until
 * the draft being left takes its place.
 */
export function WorkspaceDrafts({ drafts, activeDraftId, collapsed: collapsedProp, onToggleCollapsed, onOpenDraft, onDeleteDraft }: WorkspaceDraftsProps) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { t } = useMobileLocale()
  const motion = useIconMotion()
  const [storedCollapsed, setStoredCollapsed] = useState(false)
  const collapsed = collapsedProp ?? storedCollapsed
  const toggleCollapsed = () => {
    if (onToggleCollapsed) onToggleCollapsed()
    else setStoredCollapsed((current) => !current)
  }
  const [resumingId, setResumingId] = useState<string | null>(null)
  // The composer publishing this id is what hides the row from here on.
  // Doing it in render, not an effect, so there is no frame where the guard
  // has already dropped and the id has not.
  if (resumingId != null && activeDraftId === resumingId) setResumingId(null)
  const [flyOut, setFlyOut] = useState<{ draft: DraftListEntry; slotIndex: number } | null>(null)
  const [travel, setTravel] = useState(294)

  const visibleDrafts = drafts.filter((draft) =>
    hasPersistableDraftContent(draft) && draft.id !== activeDraftId && draft.id !== resumingId)
  const visibleIds = visibleDrafts.map((draft) => draft.id)
  const [slots, setSlots] = useState(visibleIds)
  const nextSlots = nextDraftSlots(slots, visibleIds, resumingId != null)
  if (nextSlots.length !== slots.length || nextSlots.some((id, index) => id !== slots[index])) setSlots(nextSlots)

  // Rows in the first painted list are already there. Only later arrivals fly in.
  const [skipEnter] = useState(() => new Set(visibleIds))

  const reserved = Math.max(slots.length, flyOut ? flyOut.slotIndex + 1 : 0)
  const target = collapsed ? 0 : reserved * DRAFT_ROW_HEIGHT
  const panelHeight = useSharedValue(target)
  const firstHeight = useRef(true)
  useEffect(() => {
    if (firstHeight.current) {
      firstHeight.current = false
      panelHeight.value = target
      return
    }
    panelHeight.value = motion
      ? withTiming(target, { duration: DRAFT_GROUP_MS, easing: Easing.bezier(...DRAFT_GROUP_EASING) })
      : target
  }, [target, motion, panelHeight])
  const panelStyle = useAnimatedStyle(() => ({ height: panelHeight.value }))

  const open = (draft: DraftListEntry) => {
    const slotIndex = Math.max(0, slots.indexOf(draft.id))
    if (motion) setFlyOut({ draft, slotIndex })
    setResumingId(draft.id)
    void Promise.resolve()
      .then(() => onOpenDraft(draft))
      .catch(() => {
        setFlyOut((current) => (current?.draft.id === draft.id ? null : current))
        setResumingId((current) => (current === draft.id ? null : current))
      })
  }

  const occupied = slots.some((id) => id !== DRAFT_SLOT_HOLE)
  if (!visibleDrafts.length && !occupied && !flyOut) return null
  const count = visibleDrafts.length

  return (
    <View testID="workspace-drafts" style={{ paddingBottom: 6 }}>
      <WorkspaceSectionHeading section="drafts" title={t('Drafts')} count={count} collapsed={collapsed} onToggle={toggleCollapsed} />
      <Animated.View
        testID="workspace-drafts-panel"
        pointerEvents={collapsed ? 'none' : 'auto'}
        accessibilityElementsHidden={collapsed}
        importantForAccessibility={collapsed ? 'no-hide-descendants' : 'auto'}
        style={[{ overflow: 'hidden' }, panelStyle]}
        onLayout={(event) => {
          const next = Math.round(event.nativeEvent.layout.width * DRAFT_FLIGHT_SCALE)
          if (next > 1) setTravel((current) => (current === next ? current : next))
        }}
      >
        {visibleDrafts.map((draft) => {
          const slotIndex = Math.max(0, slots.indexOf(draft.id))
          const enter = !skipEnter.has(draft.id)
          return (
            <DraftMotionRow
              key={draft.id}
              testID={`draft-slot-${slotIndex}-${draft.id}${enter ? '-enter' : ''}`}
              slotIndex={slotIndex}
              enter={enter}
              travel={travel}
              motion={motion}
            >
              <DraftSwipeRow draft={draft} onOpen={() => open(draft)} onDelete={() => onDeleteDraft(draft)} />
            </DraftMotionRow>
          )
        })}
        {flyOut ? (
          <DraftFlyOut key={flyOut.draft.id} slotIndex={flyOut.slotIndex} travel={travel} onDone={() => setFlyOut(null)}>
            <DraftRowFace draft={flyOut.draft} revealed={false} colors={colors} radius={radius} pendingLabel={t('Pending sync')} untitled={t('Untitled draft')} />
          </DraftFlyOut>
        ) : null}
      </Animated.View>
    </View>
  )
}

function DraftSwipeRow({ draft, onOpen, onDelete }: { draft: DraftListEntry; onOpen: () => void; onDelete: () => void }) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { t } = useMobileLocale()
  return (
    <SwipeRow
      subject={draft.title || t('Untitled draft')}
      variant="floating"
      onPress={onOpen}
      actions={[{
        key: 'delete',
        label: t('Delete draft'),
        icon: Trash2,
        tone: 'destructive',
        confirm: { title: t('Delete draft'), message: draft.title || t('Untitled draft'), confirmLabel: t('Delete') },
        onPress: onDelete,
      }]}
    >
      {({ revealed }) => (
        <DraftRowFace draft={draft} revealed={revealed} colors={colors} radius={radius} pendingLabel={t('Pending sync')} untitled={t('Untitled draft')} />
      )}
    </SwipeRow>
  )
}

function DraftRowFace({
  draft,
  revealed,
  colors,
  radius,
  pendingLabel,
  untitled,
}: {
  draft: DraftListEntry
  revealed: boolean
  colors: { muted: string; surface: string; mutedForeground: string; foreground: string; warning: string }
  radius: { md: number }
  pendingLabel: string
  untitled: string
}) {
  return (
    <View style={{
      flexDirection: 'row',
      gap: 10,
      alignItems: 'center',
      height: DRAFT_ROW_HEIGHT - 2,
      paddingHorizontal: 12,
      borderRadius: radius.md,
      backgroundColor: revealed ? colors.muted : colors.surface,
    }}>
      <PencilLine size={14} color={colors.mutedForeground} />
      <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 15, color: colors.foreground }}>
        {draft.title || draft.text.trim() || untitled}
      </Text>
      {draft.pendingSync ? <Clock size={12} color={colors.warning} accessibilityLabel={pendingLabel} /> : null}
    </View>
  )
}

function DraftMotionRow({
  testID,
  slotIndex,
  enter,
  travel,
  motion,
  children,
}: {
  testID: string
  slotIndex: number
  enter: boolean
  travel: number
  motion: boolean
  children: ReactNode
}) {
  const x = useSharedValue(enter && motion ? travel : 0)
  const opacity = useSharedValue(enter && motion ? 0 : 1)
  const y = useSharedValue(slotIndex * DRAFT_ROW_HEIGHT)
  useEffect(() => {
    const to = slotIndex * DRAFT_ROW_HEIGHT
    y.value = motion
      ? withTiming(to, { duration: DRAFT_GROUP_MS, easing: Easing.bezier(...DRAFT_GROUP_EASING) })
      : to
  }, [slotIndex, motion, y])
  useEffect(() => {
    if (!enter || !motion) return
    const easing = Easing.bezier(...DRAFT_SLIDE_IN_EASING)
    const slide = { duration: DRAFT_SLIDE_IN_MS, easing }
    x.value = withDelay(DRAFT_SLIDE_IN_DELAY_MS, withTiming(0, slide))
    opacity.value = withDelay(DRAFT_SLIDE_IN_DELAY_MS, withTiming(1, slide))
  }, [enter, motion, x, opacity])
  const style = useAnimatedStyle(() => ({
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: DRAFT_ROW_HEIGHT,
    opacity: opacity.value,
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }))
  return <Animated.View testID={testID} style={style} pointerEvents="box-none">{children}</Animated.View>
}

function DraftFlyOut({
  slotIndex,
  travel,
  onDone,
  children,
}: {
  slotIndex: number
  travel: number
  onDone: () => void
  children: ReactNode
}) {
  const x = useSharedValue(0)
  const opacity = useSharedValue(1)
  const done = useRef(onDone)
  const distance = useRef(travel)
  useEffect(() => { done.current = onDone }, [onDone])
  useEffect(() => {
    const easing = Easing.bezier(...DRAFT_SLIDE_OUT_EASING)
    x.value = withTiming(distance.current, { duration: DRAFT_SLIDE_OUT_MS, easing })
    opacity.value = withTiming(0, { duration: DRAFT_SLIDE_OUT_MS, easing })
    const timer = setTimeout(() => done.current(), DRAFT_SLIDE_OUT_MS)
    return () => clearTimeout(timer)
  }, [opacity, x])
  const style = useAnimatedStyle(() => ({
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: DRAFT_ROW_HEIGHT,
    opacity: opacity.value,
    transform: [{ translateX: x.value }, { translateY: slotIndex * DRAFT_ROW_HEIGHT }],
  }))
  return (
    <Animated.View testID="draft-fly-out" pointerEvents="none" style={style}>
      {children}
    </Animated.View>
  )
}
