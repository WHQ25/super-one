import { ScrollView } from 'react-native'
import { useMobileStyles } from '../theme/context'
import { BranchPicker } from '../ui/branch-picker'
import { SCROLL_INDICATOR_GUTTER } from '../ui/scroll-gutter'
import type { ShellGitInfo } from './settings-screen'

export type BranchScreenProps = {
  branches: string[]
  currentBranch?: string | null
  dirty?: ShellGitInfo['dirty']
  onSwitch: (branch: string) => Promise<void>
  onCreate: (branch: string) => Promise<void>
  onDone: () => void
}

/**
 * A page for the same reason the worktree picker is one — a real repository
 * has more branches than a sheet can show. Unlike the worktree form there is
 * nothing to confirm: picking a branch is the action, so the page returns as
 * soon as the checkout succeeds.
 */
export function BranchScreen(props: BranchScreenProps) {
  const styles = useMobileStyles()
  // A page needs its own scroller: the picker's list is a plain View so that it
  // does not fight the surrounding ScrollView when embedded in a sheet or in settings.
  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={styles.flex}
      contentContainerStyle={{ paddingRight: SCROLL_INDICATOR_GUTTER }}>
      <BranchPicker {...props} />
    </ScrollView>
  )
}
