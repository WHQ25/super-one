import { WorkspaceButton } from '../ui/workspace-button'
import { ArrowLeft, Bot, Folder, FolderPlus, MonitorSmartphone, MoreHorizontal, X } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import { AnimatedSessionTitle } from '../ui/animated-session-title'
import type { HarnessId, SessionForkMode } from '@superone/shared/agent-types'
import { harnessDisplayName } from '../provider-state'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { IconButton } from '../ui'
import { AnchoredMenu, useMenuAnchor } from '../ui/anchored-menu'
import { SessionMetaRow } from '../ui/session-meta-row'
import { isConnected, type DeviceStatus, type ReconnectInfo } from '../device-status'
import type { SessionGitView } from '../session-git-status'
import type { MobileRoute } from './mobile-navigator'
import { TerminalMenuBody } from '../ui/terminal-menu'
import { FilesMenuBody } from '../ui/files-menu'
import { SessionMenuBody } from '../ui/session-menu'
import type { TerminalTabUi } from '../terminal-runtime'

/** Width the confirm action and its balancing leading slot both reserve. */
const CONFIRM_SLOT_WIDTH = 76

export function mobileHeaderTitle(
  route: MobileRoute,
  projectName: string | undefined,
  sessionTitle: string,
  terminalTitle: string,
  translate: (source: string) => string = (source) => source,
): string {
  // A session title is host data and stays verbatim; the new-session placeholder
  // is our own copy, so it follows the dictionary's casing and locale.
  if (route === 'chat') return sessionTitle === 'New session' ? translate(sessionTitle) : sessionTitle
  if (route === 'terminal') return terminalTitle
  if (route === 'worktree') return translate('Worktree')
  if (route === 'branch') return translate('Branch')
  if (route === 'add-dir') return translate('Additional folders')
  if (route === 'project-picker') return translate('Projects')
  if (route === 'add-project') return translate('Add project')
  if (route === 'settings') return translate('Settings')
  if (route === 'collab-request') return translate('Collaboration request')
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
  /** The actual checkout directory for a running worktree session. */
  worktreePath?: string | null
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
  /**
   * A persistent workspace sidebar is on screen. It owns both the connection
   * readout and the way into the project/session lists, so the header drops its
   * own copies of each rather than opening a drawer on top of the same lists.
   */
  sidebarVisible?: boolean
  /** The running session's checkout; absent before it is known. */
  git?: SessionGitView | null
  /** Offered only for a plain branch — see `SessionGitChip`. */
  onOpenBranch?: () => void
  onBack: () => void
  onSwitchSession: () => void
  onOpenTerminal: () => void
  /** Browse the project's file tree from the session menu. */
  onOpenFiles: () => void
  /** Chat only: fork the open session. Passed only when the session can fork — see `SessionMenuBody`. */
  onFork?: (mode: SessionForkMode) => void
  /** Files only: return to the folder the browser is anchored to. */
  onOpenFilesRoot?: () => void
  /**
   * Files only. Search, upload and new-folder live in the trailing menu — the
   * same pattern as the session and terminal headers. While the finder is open
   * that control becomes the way back out.
   */
  files?: {
    /** `computer` browses the whole host and names the machine instead of a project. */
    kind: 'project' | 'computer'
    finderOpen: boolean
    onToggleFinder: () => void
    onUploadFile: () => void
    onNewFolder: () => void
  }
  /** Trailing action that starts the add-project flow. */
  onAddProject?: () => void
  /** Collaboration request only: how many launches the request carries. A readout, not a control. */
  launchCount?: number
  /** Terminal only: the trailing menu lists, creates and closes tabs. */
  terminal?: {
    tabs: TerminalTabUi[]
    activeId: string
    onSelect: (terminalId: string) => void
    onCreate: () => void
    onClose: (terminalId: string) => void
  }
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
  const showConnectionStatus = !props.sidebarVisible
  const terminal = props.route === 'terminal' ? props.terminal : undefined
  const showMeta = (chat && props.hasSession)
    || (showConnectionStatus && !connected)
  // The device list carries its own wordmark inside the page, and session search
  // is a search field with a Cancel beside it — both own their whole screen.
  if (props.route === 'pair' || props.route === 'session-search') return null
  return (
    <View style={chat ? [styles.top, styles.topBorderless] : styles.top}>
      <View style={props.onConfirm ? { minWidth: CONFIRM_SLOT_WIDTH, alignItems: 'flex-start' } : undefined}>
        {chat
          // Balances the trailing session menu; the sidebar is already the way out.
          ? props.sidebarVisible ? <View style={styles.headerTrailingSpacer} />
            : <WorkspaceButton pendingCount={props.pendingCount} onPress={props.onSwitchSession} />
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
          subtitle={terminal ? undefined
            : chat && props.worktreePath ? props.worktreePath
              : props.subtitle || harnessDisplayName(props.provider)}
          git={terminal ? null : props.git} onOpenBranch={terminal ? undefined : props.onOpenBranch}
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
        : props.launchCount != null ? <View accessible accessibilityLabel={`${props.launchCount} requested launch${props.launchCount === 1 ? '' : 'es'}`}
            style={[styles.headerTrailingSpacer, { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }]}>
            <Bot size={16} color={tokens.colors.mutedForeground} />
            <Text style={{ fontSize: 13, color: tokens.colors.mutedForeground, fontVariant: ['tabular-nums'] }}>{props.launchCount}</Text>
          </View>
        : chat ? <IconButton buttonRef={menu.ref} icon={MoreHorizontal} label="Session actions" onPress={menu.open} />
        : terminal ? <IconButton buttonRef={menu.ref} icon={MoreHorizontal} label="Terminal actions" onPress={menu.open} />
        : files ? files.finderOpen
          ? <IconButton
              icon={X}
              label={files.kind === 'computer' ? 'Close go to folder' : 'Close search'}
              onPress={files.onToggleFinder} />
          : <IconButton buttonRef={menu.ref} icon={MoreHorizontal} label="File actions" onPress={menu.open} />
        // Balance the leading icon button so the title group stays optically centred.
        : <View style={styles.headerTrailingSpacer} />}
      <AnchoredMenu anchor={menu.anchor} title={files ? 'Files' : terminal ? 'Terminal' : 'Session'} onDismiss={menu.close} width={260}>
        {files ? (
          <FilesMenuBody
            kind={files.kind}
            onSearch={() => { menu.close(); files.onToggleFinder() }}
            onUploadFile={() => { menu.close(); files.onUploadFile() }}
            onNewFolder={() => { menu.close(); files.onNewFolder() }}
          />
        ) : terminal ? (
          <TerminalMenuBody
            tabs={terminal.tabs}
            activeId={terminal.activeId}
            onSelect={(terminalId) => { menu.close(); terminal.onSelect(terminalId) }}
            onCreate={() => { menu.close(); terminal.onCreate() }}
            onClose={terminal.onClose}
          />
        ) : (
          <SessionMenuBody
            onOpenTerminal={() => { menu.close(); props.onOpenTerminal() }}
            onOpenFiles={() => { menu.close(); props.onOpenFiles() }}
            onFork={props.onFork ? (mode) => { menu.close(); props.onFork?.(mode) } : undefined}
          />
        )}
      </AnchoredMenu>
    </View>
  )
}
