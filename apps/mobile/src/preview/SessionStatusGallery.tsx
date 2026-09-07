import { useEffect, useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import { SessionMetaRow } from '../ui/session-meta-row'
import { useMobileTheme } from '../theme/context'
import type { DeviceStatus, ReconnectInfo } from '../device-status'
import type { SessionGitView } from '../session-git-status'

type Row = {
  label: string
  status: DeviceStatus
  reconnect?: ReconnectInfo
  subtitle?: string
  git?: SessionGitView | null
}

/** How long the two waiting rows count down before the gallery re-arms them. */
const RETRY_WINDOW_S = 9

const BRANCH: SessionGitView = { kind: 'branch', branch: 'feat/mobile-ui', dirtyFiles: 0 }

/**
 * Every state the line under the chat title can reach, in one scroll.
 *
 * It exists because the interesting states are the unreachable ones: a healthy
 * session is `connectedLan` on a clean branch forever, and the reconnect
 * countdown, a detached worktree and a deleted worktree only appear when
 * something has gone wrong on the desktop. Reproducing those by hand means
 * pulling a cable or deleting a directory mid-session.
 *
 * The rows render the shipping `SessionMetaRow`, not a copy of it, so a change
 * to the real component shows up here or nowhere.
 */
function buildRows(deadlineMs: number): Row[] {
  /** `delayMs` past 8s is what turns the readout amber. */
  const waiting = (delayMs: number): ReconnectInfo =>
    ({ attempting: true, waiting: true, delayMs, nextAtMs: deadlineMs })
  return [
    { label: 'Connected · LAN', status: 'connectedLan', subtitle: 'super-one', git: BRANCH },
    { label: 'Connected · relay (cloud)', status: 'connectedCloud', subtitle: 'super-one', git: BRANCH },
    { label: 'Reconnecting · attempting now', status: 'connecting', git: BRANCH,
      reconnect: { attempting: true, waiting: false, delayMs: 500, nextAtMs: null } },
    { label: 'Reconnecting · waiting out a short backoff', status: 'connecting', git: BRANCH, reconnect: waiting(2_000) },
    { label: 'Reconnecting · backoff past 8s (amber)', status: 'connecting', git: BRANCH, reconnect: waiting(16_000) },
    { label: 'Reconnecting · no backoff reported', status: 'connecting', git: BRANCH },
    { label: 'Searching the local network', status: 'searchingLan', subtitle: 'super-one', git: BRANCH },
    { label: 'Offline · desktop shut down or kicked', status: 'offline', subtitle: 'super-one', git: BRANCH },
    { label: 'Reachable but not ours (device list only)', status: 'onlineLan', subtitle: 'super-one' },
    { label: 'Checkout · uncommitted changes', status: 'connectedLan', subtitle: 'super-one',
      git: { kind: 'branch', branch: 'feat/mobile-ui', dirtyFiles: 27 } },
    { label: 'Checkout · long branch name truncates', status: 'connectedLan', subtitle: 'super-one',
      git: { kind: 'branch', branch: 'feat/very-long-branch-name-that-must-truncate', dirtyFiles: 3 } },
    { label: 'Checkout · detached HEAD', status: 'connectedLan', subtitle: 'super-one',
      git: { kind: 'detached', head: 'a1b2c3d' } },
    { label: 'Checkout · worktree on a branch', status: 'connectedLan', subtitle: 'super-one',
      git: { kind: 'worktreeBranch', branch: 'review/pr-482' } },
    { label: 'Checkout · detached worktree', status: 'connectedLan', subtitle: 'super-one',
      git: { kind: 'worktreeDetached', head: '9f3c1d7' } },
    { label: 'Checkout · worktree deleted under the session', status: 'connectedLan', subtitle: 'super-one',
      git: { kind: 'worktreeMissing' } },
    { label: 'No checkout known yet', status: 'connectedLan', subtitle: 'super-one' },
    { label: 'No project · harness name stands in', status: 'connectedLan', subtitle: 'Claude Code' },
  ]
}

/**
 * Re-arms the retry deadline every window, so the countdown keeps running
 * instead of freezing at `0s` the way a fixed fixture deadline would.
 */
function useRollingDeadline(): number {
  const [deadline, setDeadline] = useState(() => Date.now() + RETRY_WINDOW_S * 1_000)
  useEffect(() => {
    const timer = setInterval(
      () => setDeadline(Date.now() + RETRY_WINDOW_S * 1_000),
      RETRY_WINDOW_S * 1_000,
    )
    return () => clearInterval(timer)
  }, [])
  return deadline
}

export function SessionStatusGallery(props: { onOpenBranch: () => void }) {
  const { tokens: { colors } } = useMobileTheme()
  const deadline = useRollingDeadline()
  const rows = useMemo(() => buildRows(deadline), [deadline])
  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 4 }}>
      <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '500', color: colors.foreground }}>
        Connection and checkout
      </Text>
      <Text style={{ fontSize: 12, lineHeight: 18, color: colors.mutedForeground }}>
        The line under the chat title. The glyph names the route the session takes —
        Wi-Fi on the LAN, cloud through the relay. A spinning status takes the whole
        row: the reconnect rows below are all given a branch, and none of them show
        it. Tap a branch to open its sheet; a worktree is fixed for the session and
        does not respond.
      </Text>
      {rows.map((row) => (
        <View key={row.label} style={{ gap: 2, paddingTop: 10 }}>
          <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{row.label}</Text>
          <SessionMetaRow deviceStatus={row.status} reconnect={row.reconnect}
            subtitle={row.subtitle} git={row.git} onOpenBranch={props.onOpenBranch} />
        </View>
      ))}
    </ScrollView>
  )
}
