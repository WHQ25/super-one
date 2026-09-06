import { ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import { GitChips } from '../ui'
import { useMobileTheme } from '../theme/context'
import { LOCAL_WORKTREE_SELECTION, type NewSessionWorktreeSelection } from '../worktree-state'
import {
  PREVIEW_BRANCHES,
  PREVIEW_WORKTREE_INFO,
} from './git-fixtures'

type Row = {
  label: string
  selection: NewSessionWorktreeSelection
  branch?: string | null
  dirty?: boolean
  locked?: boolean
}

/**
 * Every state the two indicators can reach, in the order the desktop's
 * `WorkDirState` declares them, so the two surfaces can be compared row by
 * row. The desktop's remote-node `local` variant is absent on purpose: a
 * phone only ever sees projects that live on the paired desktop.
 */
const ROWS: Row[] = [
  { label: 'Local · clean', selection: LOCAL_WORKTREE_SELECTION, branch: 'main' },
  { label: 'Local · uncommitted changes', selection: LOCAL_WORKTREE_SELECTION, branch: 'feat/mobile-ui', dirty: true },
  { label: 'Local · long branch name', selection: LOCAL_WORKTREE_SELECTION, branch: 'feat/very-long-branch-name-that-must-truncate', dirty: true },
  { label: 'Local · not a git repository', selection: LOCAL_WORKTREE_SELECTION, branch: null },
  { label: 'Local · session started (locked)', selection: LOCAL_WORKTREE_SELECTION, branch: 'main', dirty: true, locked: true },
  { label: 'Worktree · on a branch', selection: { kind: 'existing', path: '/workspace/.worktrees/review', branch: 'review/pr-482' } },
  { label: 'Worktree · detached HEAD', selection: { kind: 'existing', path: '/workspace/.worktrees/detached' } },
  { label: 'Worktree · detached, unknown HEAD', selection: { kind: 'existing', path: '/workspace/.worktrees/gone' } },
  { label: 'Worktree · locked to the session', selection: { kind: 'existing', path: '/workspace/.worktrees/review', branch: 'review/pr-482' }, locked: true },
  { label: 'Pending · create branch', selection: { kind: 'create', baseBranch: 'main', mode: 'branch', branchName: 'feat/new-idea', carryLocalChanges: false } },
  { label: 'Pending · create branch, unnamed', selection: { kind: 'create', baseBranch: 'main', mode: 'branch', branchName: '', carryLocalChanges: false } },
  { label: 'Pending · name already taken', selection: { kind: 'create', baseBranch: 'main', mode: 'branch', branchName: 'release/1.4', carryLocalChanges: false } },
  { label: 'Pending · attach to branch', selection: { kind: 'create', baseBranch: 'fix/pairing-timeout', mode: 'attach', branchName: '', carryLocalChanges: false } },
  { label: 'Pending · attach blocked (checked out)', selection: { kind: 'create', baseBranch: 'release/1.4', mode: 'attach', branchName: '', carryLocalChanges: false } },
  { label: 'Pending · create from (detached)', selection: { kind: 'create', baseBranch: 'main', mode: 'detach', branchName: '', carryLocalChanges: true } },
]

export function GitIndicatorGallery(props: {
  onOpenWorktree: (selection: NewSessionWorktreeSelection) => void
  onOpenBranch: () => void
}) {
  const { tokens: { colors } } = useMobileTheme()
  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 4 }}>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '500', color: colors.foreground }}>
          Working directory and branch
        </Text>
        <Text style={{ fontSize: 12, lineHeight: 18, color: colors.mutedForeground }}>
          Desktop parity for `WorkDirIndicator` and the branch popover trigger. The branch chip
          only appears on the primary checkout; a commit mark means a detached HEAD. Tap a chip
          to open its sheet seeded with that row's state.
        </Text>
        {ROWS.map((row) => (
          <View key={row.label} style={{ gap: 2, paddingTop: 10 }}>
            <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{row.label}</Text>
            <GitChips selection={row.selection} worktreeInfo={PREVIEW_WORKTREE_INFO} branch={row.branch}
              dirty={row.dirty} locked={row.locked}
              onWorktree={() => props.onOpenWorktree(row.selection)} onBranch={props.onOpenBranch} />
          </View>
        ))}
    </ScrollView>
  )
}
