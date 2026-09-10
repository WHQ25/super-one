import { View } from 'react-native'
import { useMobileStyles } from '../theme/context'
import type { DeviceStatus, ReconnectInfo } from '../device-status'
import { SidebarDeviceFooter } from './sidebar-device-footer'
import { WorkspaceList, type WorkspaceListProps } from './workspace-list'

export type WorkspaceSidebarProps = Omit<WorkspaceListProps, 'onLeave' | 'visible'> & {
  deviceName: string
  deviceStatus: DeviceStatus
  reconnect?: ReconnectInfo | null
  onDisconnect: () => void
  onOpenSettings: () => void
}

/**
 * The workspace as a permanent pane, shown once the window is wide enough to
 * hold one beside the detail view — a tablet, or a phone turned landscape.
 *
 * It is a sibling of the detail column (header + scene), not a child of it, so
 * the pane occupies the full window height. Anything shorter would leave the
 * session title bar sitting on top of the list the way a phone drawer does.
 *
 * It shows exactly what the drawer shows, because it *is* the drawer's contents:
 * anything narrower would make "switch project" a thing you could only do by
 * opening a modal on top of the sidebar that was already listing sessions, which
 * is what this pane used to be. Nothing here leaves a panel behind, so
 * `WorkspaceList` gets no `onLeave`.
 */
export function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  const styles = useMobileStyles()
  return (
    <View style={styles.tabletSidebar}>
      <WorkspaceList {...props} visible />
      <SidebarDeviceFooter
        deviceName={props.deviceName}
        deviceStatus={props.deviceStatus}
        reconnect={props.reconnect}
        onDisconnect={props.onDisconnect}
        onOpenSettings={props.onOpenSettings}
      />
    </View>
  )
}
