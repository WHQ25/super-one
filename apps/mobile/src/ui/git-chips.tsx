import type { ReactNode } from 'react'
import { ChevronDown, GitBranch, GitCommitHorizontal, Laptop } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { Text } from './text'
import type { WorktreeInfo } from '@superone/shared/agent-types'
import { useMobileTheme } from '../theme/context'
import { workDirChipState, type NewSessionWorktreeSelection, type WorkDirChipState } from '../worktree-state'

/**
 * The pair of centred chips under the project field: where the session will
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
  const state = workDirChipState(props.selection, props.worktreeInfo)
  const muted = { fontSize: 14, color: colors.mutedForeground }
  const strong = { fontSize: 14, color: colors.foreground, flexShrink: 1 }
  const chip = (label: string, onPress: () => void, children: ReactNode) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled: props.locked }} disabled={props.locked} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 36, flexShrink: 1,
        minWidth: 0, paddingHorizontal: 6, borderRadius: radius.sm, backgroundColor: pressed ? colors.muted : 'transparent' })}>
      {children}
      {props.locked ? null : <ChevronDown size={16} color={colors.mutedForeground} />}
    </Pressable>
  )
  // Detached HEAD and a detached-worktree plan are commits; everything else on
  // a worktree is a branch. Same split as the desktop's `workDirIcon`.
  const Mark = state.kind === 'activeDetached' || state.kind === 'createFrom' ? GitCommitHorizontal : GitBranch
  const workDir = chip(workDirChipLabel(state), props.onWorktree, state.kind === 'local' ? <>
    <Laptop size={18} color={colors.mutedForeground} />
    <Text style={muted}>Local</Text>
  </> : <>
    <Text numberOfLines={1} style={state.kind === 'activeBranch' || state.kind === 'activeDetached' ? muted : { fontSize: 13, color: colors.mutedForeground }}>
      {workDirPrefix(state)}
    </Text>
    <Mark size={14} color={colors.mutedForeground} />
    <Text numberOfLines={1} style={strong}>{workDirValue(state)}</Text>
  </>)
  const showBranch = state.kind === 'local' && !!props.branch
  if (!showBranch) return <View style={{ flexDirection: 'row', justifyContent: 'center' }}>{workDir}</View>
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
      {workDir}
      <View style={{ width: 1, height: 16, marginHorizontal: 8, backgroundColor: colors.border }} />
      {chip(`Branch: ${props.branch}`, props.onBranch, <>
        <GitBranch size={18} color={colors.mutedForeground} />
        <Text numberOfLines={1} style={[muted, { flexShrink: 1 }]}>{props.branch}</Text>
        {props.dirty ? <View accessibilityLabel="Uncommitted changes"
          style={{ width: 7, height: 7, marginLeft: 2, borderRadius: 4, backgroundColor: colors.warning }} /> : null}
      </>)}
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
