import { ArrowLeft, Menu, MoreHorizontal, Settings, SquareTerminal } from 'lucide-react-native'
import { Image, View } from 'react-native'
import { Text } from '../ui/text'
import type { HarnessId } from '@superone/shared/agent-types'
import { harnessDisplayName } from '../provider-state'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { IconButton, HarnessIcon } from '../ui'
import { AnchoredMenu, MenuRow, MenuSeparator, useMenuAnchor } from '../ui/anchored-menu'
import type { MobileRoute } from './mobile-navigator'

const wordmark = require('../../assets/logo-text.png')
/** Intrinsic 484×96; the height is the design input, the width follows it. */
const WORDMARK_HEIGHT = 24
const WORDMARK_WIDTH = Math.round(WORDMARK_HEIGHT * (484 / 96))

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
  if (route === 'settings') return 'Project settings'
  if (route === 'files') return 'Files'
  return 'SuperOne'
}

export function MobileHeader(props: {
  route: MobileRoute
  title: string
  subtitle?: string
  provider: HarnessId
  acpAgentId?: string | null
  streaming: boolean
  connectionState: 'connected' | 'reconnecting' | 'offline'
  onBack: () => void
  onSwitchSession: () => void
  onOpenTerminal: () => void
  onOpenSettings: () => void
}) {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
  const menu = useMenuAnchor()
  const chat = props.route === 'chat'
  const statusColor = props.connectionState === 'connected' ? tokens.colors.success
    : props.connectionState === 'reconnecting' ? tokens.colors.warning : tokens.colors.mutedForeground
  // The device list is the app's front door and carries no back or overflow
  // action, so the wordmark owns the whole bar rather than sitting flush left.
  if (props.route === 'pair') {
    return (
      <View style={[styles.top, { justifyContent: 'center' }]}>
        <Image
          accessibilityLabel="SuperOne"
          accessible
          resizeMode="contain"
          source={wordmark}
          style={{ height: WORDMARK_HEIGHT, width: WORDMARK_WIDTH }}
          testID="app-wordmark"
        />
      </View>
    )
  }
  return (
    <View style={styles.top}>
      <IconButton icon={chat ? Menu : ArrowLeft}
        label={chat ? 'Open workspace' : 'Back'} onPress={chat ? props.onSwitchSession : props.onBack} />
      <View style={styles.headerTitleGroup}>
        <View style={styles.headerTitleRow}>
          {chat ? <HarnessIcon provider={props.provider} acpAgentId={props.acpAgentId} status={props.streaming ? 'running' : 'default'} size={20} /> : null}
          <Text numberOfLines={1} style={styles.title}>{props.title}</Text>
        </View>
        {chat || props.route === 'terminal' ? <View style={styles.headerMetaRow}>
          <View accessibilityLabel={props.connectionState} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
          <Text numberOfLines={1} style={{ color: tokens.colors.mutedForeground, fontSize: 12, flexShrink: 1 }}>
            {props.connectionState === 'connected' ? props.subtitle || harnessDisplayName(props.provider) : props.connectionState}
          </Text>
        </View> : null}
      </View>
      {chat ? <IconButton buttonRef={menu.ref} icon={MoreHorizontal} label="Session actions" onPress={menu.open} />
        : props.route === 'sessions' ? <IconButton icon={Settings} label="Settings" onPress={props.onOpenSettings} /> : null}
      <AnchoredMenu anchor={menu.anchor} title="Session" onDismiss={menu.close} width={260}>
        <MenuRow label="Terminal" leading={<SquareTerminal size={18} color={tokens.colors.mutedForeground} />} onPress={() => { menu.close(); props.onOpenTerminal() }} />
        <MenuRow label="Project settings" leading={<Settings size={18} color={tokens.colors.mutedForeground} />} onPress={() => { menu.close(); props.onOpenSettings() }} />
        <MenuSeparator />
        <MenuRow label="Leave session" leading={<ArrowLeft size={18} color={tokens.colors.mutedForeground} />} onPress={() => { menu.close(); props.onBack() }} />
      </AnchoredMenu>
    </View>
  )
}
