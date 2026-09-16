import { FolderClosed, GitFork, SquareTerminal } from 'lucide-react-native'
import type { SessionForkMode } from '@superone/shared/agent-types'
import { useMobileTheme } from '../theme/context'
import { MenuRow, MenuSeparator } from './anchored-menu'

export function SessionMenuBody(props: {
  onOpenTerminal: () => void
  onOpenFiles: () => void
  /**
   * Absent rather than disabled when the session cannot fork — no session yet,
   * a harness without a transcript-fork API, or a session already living in a
   * worktree — matching the desktop's session menu.
   */
  onFork?: (mode: SessionForkMode) => void
}) {
  const { tokens } = useMobileTheme()
  const muted = tokens.colors.mutedForeground
  return (
    <>
      <MenuRow label="Terminal" leading={<SquareTerminal size={18} color={muted} />} onPress={props.onOpenTerminal} />
      <MenuRow label="Files" leading={<FolderClosed size={18} color={muted} />} onPress={props.onOpenFiles} />
      {props.onFork ? (
        <>
          <MenuSeparator />
          <MenuRow label="Fork to new worktree" leading={<GitFork size={18} color={muted} />} onPress={() => props.onFork?.('worktree')} />
          <MenuRow label="Fork to same worktree" leading={<GitFork size={18} color={muted} />} onPress={() => props.onFork?.('local')} />
        </>
      ) : null}
    </>
  )
}
