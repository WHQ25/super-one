import { ArrowLeft, FolderPlus, Menu, MoreHorizontal, Settings, SquareTerminal } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import type { HarnessId } from '@superone/shared/agent-types'
import { harnessDisplayName } from '../provider-state'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { IconButton } from '../ui'
import { AnchoredMenu, MenuRow, MenuSeparator, useMenuAnchor } from '../ui/anchored-menu'
import type { MobileRoute } from './mobile-navigator'

/** Width the confirm action and its balancing leading slot both reserve. */
const CONFIRM_SLOT_WIDTH = 76

export function mobileHeaderTitle(
  route: MobileRoute,
  projectName: string | undefined,
  sessionTitle: string,
  terminalTitle: string,
): string {
  if (route === 'projects') return 'Projects'
  if (route === 'sessions') return projectName ?? 'Sessions'
  if (route === 'chat') return sessionTitle || 'Chat'
  if (route === 'terminal') return terminalTitle
  if (route === 'worktree') return 'Worktree'
  if (route === 'branch') return 'Branch'
  if (route === 'project-picker') return 'Projects'
  if (route === 'add-project') return 'Add Project'
  if (route === 'settings') return 'Project settings'
  if (route === 'files') return 'Files'
  return 'SuperOne'
}

export function MobileHeader(props: {
  route: MobileRoute
  title: string
  subtitle?: string
  provider: HarnessId
  /** False on the new-session landing, which names the project and branch itself. */
  hasSession?: boolean
  connectionState: 'connected' | 'reconnecting' | 'offline'
  onBack: () => void
  onSwitchSession: () => void
  onOpenTerminal: () => void
  onOpenSettings: () => void
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
  // The landing already shows project, branch and harness, so the header only
  // speaks up there when the connection needs attention.
  const showMeta = (chat || props.route === 'terminal')
    && (props.hasSession || props.connectionState !== 'connected')
  const statusColor = props.connectionState === 'connected' ? tokens.colors.success
    : props.connectionState === 'reconnecting' ? tokens.colors.warning : tokens.colors.mutedForeground
  // The device list carries its own wordmark inside the page, so it has no bar.
  if (props.route === 'pair') return null
  return (
    <View style={styles.top}>
      <View style={props.onConfirm ? { minWidth: CONFIRM_SLOT_WIDTH, alignItems: 'flex-start' } : undefined}>
        <IconButton icon={chat ? Menu : ArrowLeft}
          label={chat ? 'Open workspace' : 'Back'} onPress={chat ? props.onSwitchSession : props.onBack} />
      </View>
      <View style={styles.headerTitleGroup}>
        <View style={styles.headerTitleRow}>
          <Text numberOfLines={1} style={styles.title}>{props.title}</Text>
        </View>
        {showMeta ? <View style={styles.headerMetaRow}>
          <View accessibilityLabel={props.connectionState} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
          <Text numberOfLines={1} style={{ color: tokens.colors.mutedForeground, fontSize: 12, flexShrink: 1 }}>
            {props.connectionState === 'connected' ? props.subtitle || harnessDisplayName(props.provider) : props.connectionState}
          </Text>
        </View> : null}
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
        : props.route === 'sessions' ? <IconButton icon={Settings} label="Settings" onPress={props.onOpenSettings} />
          // Balance the leading icon button so the title group stays optically centred.
          : <View style={styles.headerTrailingSpacer} />}
      <AnchoredMenu anchor={menu.anchor} title="Session" onDismiss={menu.close} width={260}>
        <MenuRow label="Terminal" leading={<SquareTerminal size={18} color={tokens.colors.mutedForeground} />} onPress={() => { menu.close(); props.onOpenTerminal() }} />
        <MenuRow label="Project settings" leading={<Settings size={18} color={tokens.colors.mutedForeground} />} onPress={() => { menu.close(); props.onOpenSettings() }} />
        <MenuSeparator />
        <MenuRow label="Leave session" leading={<ArrowLeft size={18} color={tokens.colors.mutedForeground} />} onPress={() => { menu.close(); props.onBack() }} />
      </AnchoredMenu>
    </View>
  )
}
