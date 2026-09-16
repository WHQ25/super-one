import { useRef, useState, type ReactNode } from 'react'
import { ChevronDown, GitBranch, GitCommitHorizontal, Laptop } from 'lucide-react-native'
import { Platform, Pressable, View, type LayoutChangeEvent } from 'react-native'
import { Text } from './text'
import type { WorktreeInfo } from '@superone/shared/agent-types'
import { useMobileTheme } from '../theme/context'
import { workDirChipState, type NewSessionWorktreeSelection, type WorkDirChipState } from '../worktree-state'
import { useMobileLocale } from '../i18n/context'

/**
 * The centred chips under the project field: where the session will
 * run, and which branch it starts on. Both mirror the desktop status bar —
 * `WorkDirIndicator` plus the branch popover trigger in `ChatStatusBar`. The
 * branch chip disappears in any worktree context for the same reason it does
 * there: the branch then belongs to the worktree, not to the checkout.
 */
export function GitChips(props: {
  selection: NewSessionWorktreeSelection
  worktreeInfo?: WorktreeInfo | null
  branch?: string | null
  dirty?: boolean
  /** A started session cannot move; the chips stay as read-only labels. */
  locked?: boolean
  onWorktree: () => void
  onBranch: () => void
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { t } = useMobileLocale()
  const state = workDirChipState(props.selection, props.worktreeInfo)
  // The divider only reads as a separator while both chips share a line. Once
  // the branch chip has dropped below the work-dir chip it keeps its footprint
  // (so hiding it cannot pull the chip back up and oscillate) but goes blank.
  const rows = useRef({ workDirBottom: 0, branchTop: 0 })
  const [branchWrapped, setBranchWrapped] = useState(false)
  const track = (key: 'workDir' | 'branch') => (e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout
    if (key === 'workDir') rows.current.workDirBottom = y + height
    else rows.current.branchTop = y
    setBranchWrapped(rows.current.branchTop >= rows.current.workDirBottom)
  }
  // Android Fabric can measure Typeface.DEFAULT but draw the OEM system font.
  // An explicit family makes both paths agree (react-native#57950).
  const typography = { fontSize: 14, ...(Platform.OS === 'android' ? { fontFamily: 'sans-serif' } : {}) }
  const muted = { ...typography, color: colors.mutedForeground }
  const strong = { ...typography, color: colors.foreground }
  // A chip is a wrapping row of two units: an optional lead-in (the sentence
  // plus its branch/commit mark) and the value group (name, chevron). When
  // both fit they share a line; otherwise the value group drops to a second,
  // centred line as a whole, so the sentence and its mark stay readable above.
  const chip = (label: string, onPress: () => void, lead: ReactNode, value: ReactNode, onLayout?: (e: LayoutChangeEvent) => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onLayout={onLayout}
      accessibilityState={{ disabled: props.locked }} disabled={props.locked} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
        columnGap: 5, rowGap: 2, minHeight: 36, flexShrink: 1, minWidth: 0, paddingHorizontal: 6, paddingVertical: 4,
        borderRadius: radius.sm, backgroundColor: pressed ? colors.muted : 'transparent' })}>
      {lead}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, flexShrink: 1, minWidth: 0 }}>
        {value}
        {props.locked ? null : <ChevronDown size={16} color={colors.mutedForeground} />}
      </View>
    </Pressable>
  )
  // Detached HEAD and a detached-worktree plan are commits; everything else on
  // a worktree is a branch. Same split as the desktop's `workDirIcon`.
  const Mark = state.kind === 'activeDetached' || state.kind === 'createFrom' ? GitCommitHorizontal : GitBranch
  const workDir = state.kind === 'local'
    ? chip(t('Local'), props.onWorktree, null, <>
      <Laptop size={18} color={colors.mutedForeground} />
      <Text style={muted}>{t('Local')}</Text>
    </>, track('workDir'))
    : chip(localizedWorkDirChipLabel(state, t), props.onWorktree,
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Text style={state.kind === 'activeBranch' || state.kind === 'activeDetached' ? muted : { ...muted, fontSize: 13 }}>
          {t(workDirPrefix(state))}
        </Text>
        <Mark size={14} color={colors.mutedForeground} />
      </View>,
      <Text style={{ ...strong, flexShrink: 1, textAlign: 'center' }}>{workDirValue(state)}</Text>)
  const showBranch = state.kind === 'local' && !!props.branch
  // The chips centre on one line when they fit; a long name pushes its chip
  // (or just the name group inside it) onto the next line instead of
  // clipping, scrolling or ellipsising — the full name is always visible.
  return (
    <View style={{ alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
      {workDir}
      {showBranch ? (
        <View onLayout={track('branch')} style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1, minWidth: 0 }}>
          <View style={{ width: 1, height: 16, marginHorizontal: 6, backgroundColor: colors.border, opacity: branchWrapped ? 0 : 1 }} />
          {chip(`${t('Branch')}: ${props.branch}`, props.onBranch, null, <>
            <GitBranch size={18} color={colors.mutedForeground} />
            <Text style={{ ...muted, flexShrink: 1 }}>{props.branch}</Text>
            {props.dirty ? <View accessibilityLabel={t('Uncommitted changes')}
              style={{ width: 7, height: 7, marginLeft: 2, borderRadius: 4, backgroundColor: colors.warning }} /> : null}
          </>)}
        </View>
      ) : null}
    </View>
  )
}

function workDirPrefix(state: WorkDirChipState): string {
  switch (state.kind) {
    case 'activeBranch': case 'activeDetached': return 'Worktree'
    case 'createBranch': return 'Create worktree branch'
    case 'attachTo': return 'Attach worktree to'
    case 'createFrom': return 'Create worktree from'
    case 'local': return 'Local'
  }
}

function workDirValue(state: WorkDirChipState): string {
  switch (state.kind) {
    case 'activeBranch': return state.name
    case 'activeDetached': return state.hash || 'detached'
    case 'createBranch': return state.name || '…'
    case 'attachTo': case 'createFrom': return state.base
    case 'local': return ''
  }
}

/** Matches the desktop `workDirTitle` so screen readers hear the same sentence. */
export function workDirChipLabel(state: WorkDirChipState): string {
  return state.kind === 'local' ? 'Local' : `${workDirPrefix(state)} ${workDirValue(state)}`
}

function localizedWorkDirChipLabel(state: WorkDirChipState, t: (source: string) => string): string {
  return state.kind === 'local' ? t('Local') : `${t(workDirPrefix(state))} ${t(workDirValue(state))}`
}
