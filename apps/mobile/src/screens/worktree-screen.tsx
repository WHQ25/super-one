import { ScrollView } from 'react-native'
import type { WorktreeInfo } from '@superone/shared/agent-types'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { SCROLL_INDICATOR_GUTTER } from '../ui/scroll-gutter'
import { WorktreePicker } from '../ui/worktree-picker'
import type { NewSessionWorktreeSelection } from '../worktree-state'
import type { ShellGitInfo } from './settings-screen'

export type WorktreeScreenProps = {
  /** The draft the owner holds; the header commits it, going back throws it away. */
  selection: NewSessionWorktreeSelection
  onSelectionChange: (selection: NewSessionWorktreeSelection) => void
  gitInfo: ShellGitInfo | null
  worktreeInfo: WorktreeInfo | null
  worktreeDirty?: Record<string, number>
  branches: string[]
  checkedOutBranches: string[]
}

/**
 * A page, not a sheet: choosing where the session runs is a short form —
 * base branch, mode, branch name, whether to carry local changes — and a
 * keyboard leaves a bottom sheet almost no room.
 */
export function WorktreeScreen(props: WorktreeScreenProps) {
  const styles = useMobileStyles()
  const { tokens: { spacing } } = useMobileTheme()
  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={styles.flex}
      contentContainerStyle={{ paddingRight: SCROLL_INDICATOR_GUTTER, paddingBottom: spacing.lg }}>
      <WorktreePicker {...props} />
    </ScrollView>
  )
}
