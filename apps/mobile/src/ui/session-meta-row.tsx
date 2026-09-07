import { View } from 'react-native'
import { Text } from './text'
import { ConnectionStatusIndicator } from './connection-status'
import { SessionGitChip } from './session-git-chip'
import { describeDeviceStatus, type DeviceStatus, type ReconnectInfo } from '../device-status'
import type { SessionGitView } from '../session-git-status'
import { useMobileStyles, useMobileTheme } from '../theme/context'

/**
 * The line under the chat title: how the phone is reaching the desktop, and
 * which checkout the session runs in.
 *
 * Its own component rather than markup inside `MobileHeader` so the preview
 * gallery can walk every state through the shipping code — the states that
 * matter most here (reconnect backoff, a deleted worktree) are the ones a
 * healthy session never reaches.
 */
export function SessionMetaRow(props: {
  deviceStatus: DeviceStatus
  reconnect?: ReconnectInfo | null
  /** Usually the project name; falls back to the harness where there is none. */
  subtitle?: string
  git?: SessionGitView | null
  onOpenBranch?: () => void
}) {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
  // A status that spins takes the whole row: it says what it is doing and how
  // long the next attempt is away, and a moving glyph beside static text reads
  // as if the static text were loading too. `spin` — not a status list — is the
  // condition, so a future animated status is covered without touching this.
  // Nothing is lost: the project and the checkout are exactly where they were.
  const busy = describeDeviceStatus(props.deviceStatus).spin
  return (
    <View style={styles.headerMetaRow}>
      <ConnectionStatusIndicator status={props.deviceStatus} reconnect={props.reconnect}
        showLabel={busy} iconSize={12} fontSize={11} />
      {busy ? null : <>
        {props.subtitle ? (
          <Text numberOfLines={1} style={{ color: tokens.colors.mutedForeground, fontSize: 11, flexShrink: 1 }}>
            {props.subtitle}
          </Text>
        ) : null}
        {props.git ? <SessionGitChip view={props.git} onPress={props.onOpenBranch} /> : null}
      </>}
    </View>
  )
}
