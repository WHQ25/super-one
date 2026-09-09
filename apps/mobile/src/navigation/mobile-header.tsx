import { WorkspaceButton } from '../ui/workspace-button'
import { ArrowLeft, Folder, FolderClosed, FolderPlus, MonitorSmartphone, MoreHorizontal, Search, SquareTerminal, TextCursorInput } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import { AnimatedSessionTitle } from '../ui/animated-session-title'
import type { HarnessId } from '@superone/shared/agent-types'
import { harnessDisplayName } from '../provider-state'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { IconButton } from '../ui'
import { AnchoredMenu, MenuRow, useMenuAnchor } from '../ui/anchored-menu'
import { SessionMetaRow } from '../ui/session-meta-row'
import { isConnected, type DeviceStatus, type ReconnectInfo } from '../device-status'
import type { SessionGitView } from '../session-git-status'
import type { MobileRoute } from './mobile-navigator'

/** Width the confirm action and its balancing leading slot both reserve. */
const CONFIRM_SLOT_WIDTH = 76

export function mobileHeaderTitle(
  route: MobileRoute,
  projectName: string | undefined,
  sessionTitle: string,
  terminalTitle: string,
  translate: (source: string) => string = (source) => source,
): string {
  if (route === 'chat') return sessionTitle || translate('Chat')
  if (route === 'terminal') return terminalTitle
  if (route === 'worktree') return translate('Worktree')
  if (route === 'branch') return translate('Branch')
  if (route === 'add-dir') return translate('Additional folders')
  // The caller substitutes the file name; this is only the fallback.
  if (route === 'file-preview') return translate('Preview')
  if (route === 'project-picker') return translate('Projects')
  if (route === 'add-project') return translate('Add project')
  if (route === 'settings') return translate('Settings')
  // Files names whatever it is anchored to — a project folder or the machine —
  // and that name is the way back to the top of it.
  if (route === 'files') return projectName ?? translate('Files')
  return 'SuperOne'
}

export function MobileHeader(props: {
  route: MobileRoute
  pendingCount?: number
  title: string
  subtitle?: string
  provider: HarnessId
  /** False on the new-session landing, which names the project and branch itself. */
  hasSession?: boolean
  sessionId?: string | null
  /**
   * The full status of the desktop we are paired with, not a three-state
   * summary: the glyph is how the user learns *which* route the session takes
   * (Wi-Fi on the LAN, cloud through the relay), which used to be invisible here.
   */
  deviceStatus: DeviceStatus
  /** Drives the retry countdown while `deviceStatus` is `connecting`. */
  reconnect?: ReconnectInfo | null
  /** The tablet sidebar owns the connection readout when present. */
  connectionInSidebar?: boolean
  /** The running session's checkout; absent before it is known. */
  git?: SessionGitView | null
  /** Offered only for a plain branch — see `SessionGitChip`. */
  onOpenBranch?: () => void
  onBack: () => void
  onSwitchSession: () => void
  onOpenTerminal: () => void
  /** Browse the project's file tree from the session menu. */
  onOpenFiles: () => void
  /** Files only: return to the folder the browser is anchored to. */
  onOpenFilesRoot?: () => void
  /**
   * Files only. The finder toggle is the one action that belongs in the bar:
   * everything else the browser can do is anchored to the folder on screen, so it
   * lives down there with it — pull to refresh, buttons at the bottom.
   */
  files?: {
    /** `computer` browses the whole host and names the machine instead of a project. */
    kind: 'project' | 'computer'
    finderOpen: boolean
    onToggleFinder: () => void
  }
  /** Trailing action that starts the add-project flow. */
  onAddProject?: () => void
  /** Commits the screen's draft. Back discards it, so only routes with a draft pass this. */
  onConfirm?: () => void
  /** Action label; defaults to `Confirm`. */
  confirmLabel?: string
  confirmDisabled?: boolean
}) {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
  const menu = useMenuAnchor()
  const chat = props.route === 'chat'
  const files = props.route === 'files' ? props.files : undefined
  // Session pages always keep their checkout metadata. Every other native
  // header adds this second line only while the connection needs attention.
  const connected = isConnected(props.deviceStatus)
  const showConnectionStatus = !props.connectionInSidebar
  const showMeta = ((chat || props.route === 'terminal') && props.hasSession)
    || (showConnectionStatus && !connected)
  // The device list carries its own wordmark inside the page, and session search
  // is a search field with a Cancel beside it — both own their whole screen.
  if (props.route === 'pair' || props.route === 'session-search') return null
  return (
    <View style={styles.top}>
      <View style={props.onConfirm ? { minWidth: CONFIRM_SLOT_WIDTH, alignItems: 'flex-start' } : undefined}>
        {chat ? <WorkspaceButton pendingCount={props.pendingCount} onPress={props.onSwitchSession} />
          : <IconButton icon={ArrowLeft} label="Back" onPress={props.onBack} />}
      </View>
      <View style={styles.headerTitleGroup}>
        {props.route === 'files' ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Go to ${props.title}`}
            onPress={props.onOpenFilesRoot}
            style={({ pressed }) => [styles.headerTitleRow, { gap: 6, opacity: pressed ? 0.6 : 1 }]}>
            {files?.kind === 'computer'
              ? <MonitorSmartphone size={15} color={tokens.colors.mutedForeground} />
              : <Folder size={15} color={tokens.colors.mutedForeground} />}
            <Text numberOfLines={1} style={styles.title}>{props.title}</Text>
          </Pressable>
        ) : (
          <View style={styles.headerTitleRow}>
            {chat && props.hasSession
              ? <AnimatedSessionTitle key={props.sessionId} title={props.title} style={[styles.title, { fontSize: 15, textAlign: 'center' }]} />
              : <Text numberOfLines={1} style={styles.title}>{props.title}</Text>}
          </View>
        )}
        {showMeta ? <SessionMetaRow deviceStatus={props.deviceStatus} reconnect={props.reconnect}
          subtitle={props.subtitle || harnessDisplayName(props.provider)}
          git={props.git} onOpenBranch={props.onOpenBranch}
          showConnectionStatus={showConnectionStatus} /> : null}
      </View>
      {props.onConfirm ? <Pressable accessibilityRole="button" accessibilityLabel={props.confirmLabel ?? 'Confirm'}
        accessibilityState={{ disabled: props.confirmDisabled }} disabled={props.confirmDisabled}
        onPress={props.onConfirm}
        style={({ pressed }) => ({ minWidth: CONFIRM_SLOT_WIDTH, minHeight: 44, paddingHorizontal: 8,
          alignItems: 'flex-end', justifyContent: 'center', opacity: props.confirmDisabled ? 0.35 : pressed ? 0.6 : 1 })}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: tokens.colors.primary }}>
          {props.confirmLabel ?? 'Confirm'}
        </Text>
      </Pressable>
        : props.onAddProject ? <IconButton icon={FolderPlus} label="Add project" onPress={props.onAddProject} />
        : chat ? <IconButton buttonRef={menu.ref} icon={MoreHorizontal} label="Session actions" onPress={menu.open} />
        : files ? <IconButton
            // A project is searched by filename; a whole machine is navigated by path.
            icon={files.kind === 'computer' ? TextCursorInput : Search}
            active={files.finderOpen}
            label={files.kind === 'computer'
              ? files.finderOpen ? 'Close go to folder' : 'Go to folder'
              : files.finderOpen ? 'Close search' : 'Search files'}
            onPress={files.onToggleFinder} />
        // Balance the leading icon button so the title group stays optically centred.
        : <View style={styles.headerTrailingSpacer} />}
      <AnchoredMenu anchor={menu.anchor} title="Session" onDismiss={menu.close} width={260}>
        <MenuRow label="Terminal" leading={<SquareTerminal size={18} color={tokens.colors.mutedForeground} />} onPress={() => { menu.close(); props.onOpenTerminal() }} />
        <MenuRow label="Files" leading={<FolderClosed size={18} color={tokens.colors.mutedForeground} />} onPress={() => { menu.close(); props.onOpenFiles() }} />
      </AnchoredMenu>
    </View>
  )
}
