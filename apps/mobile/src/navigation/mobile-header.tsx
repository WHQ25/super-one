import { Bot, ArrowLeft, MessageSquare, Settings, SquareTerminal } from 'lucide-react-native'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import type { HarnessId } from '@superone/shared/agent-types'
import { harnessDisplayName } from '../provider-state'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { Badge } from '../ui'
import type { MobileRoute } from './mobile-navigator'

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
  provider: HarnessId
  streaming: boolean
  connectionState: 'connected' | 'reconnecting' | 'offline'
  onBack: () => void
  onSwitchSession: () => void
  onOpenTerminal: () => void
  onOpenSettings: () => void
}) {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
  const chat = props.route === 'chat'
  return (
    <View style={styles.top}>
      {props.route !== 'pair' ? (
        <Pressable accessibilityLabel="Back" accessibilityRole="button" onPress={props.onBack}>
          <ArrowLeft color={tokens.colors.primary} size={22} />
        </Pressable>
      ) : <View />}
      <View style={styles.headerTitleGroup}>
        <View style={styles.headerTitleRow}>
          {chat ? <Bot color={tokens.colors.primary} size={18} /> : null}
          <Text numberOfLines={1} style={styles.title}>{props.title}</Text>
          {chat && props.streaming ? <ActivityIndicator color={tokens.colors.primary} size="small" /> : null}
        </View>
        {chat ? (
          <View style={styles.headerMetaRow}>
            <Badge label={harnessDisplayName(props.provider)} />
            <Badge
              label={props.connectionState}
              tone={props.connectionState === 'connected'
                ? 'success'
                : props.connectionState === 'reconnecting'
                  ? 'warning'
                  : 'error'}
            />
          </View>
        ) : null}
      </View>
      <View style={styles.headerActions}>
        {chat ? (
          <Pressable accessibilityLabel="Switch session" accessibilityRole="button" onPress={props.onSwitchSession}>
            <MessageSquare color={tokens.colors.primary} size={21} />
          </Pressable>
        ) : null}
        {chat ? (
          <Pressable accessibilityLabel="Terminal" accessibilityRole="button" onPress={props.onOpenTerminal}>
            <SquareTerminal color={tokens.colors.primary} size={21} />
          </Pressable>
        ) : null}
        {chat || props.route === 'sessions' ? (
          <Pressable accessibilityLabel="Settings" accessibilityRole="button" onPress={props.onOpenSettings}>
            <Settings color={tokens.colors.primary} size={21} />
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}
