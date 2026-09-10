import { Menu } from 'lucide-react-native'
import { View } from 'react-native'
import { IconButton } from './icon-button'
import { useMobileTheme } from '../theme/context'

export function WorkspaceButton({ pendingCount = 0, onPress }: { pendingCount?: number; onPress: () => void }) {
  const { tokens: { colors } } = useMobileTheme()
  const waiting = pendingCount > 0
  return <View style={{ overflow: 'visible' }}>
    <IconButton icon={Menu} label={waiting ? 'Open workspace, sessions need attention' : 'Open workspace'} onPress={onPress} />
    {waiting ? <View testID="workspace-pending-badge" pointerEvents="none" accessible={false} style={{
      position: 'absolute', right: 10, top: 10, zIndex: 1, width: 8, height: 8, borderRadius: 4,
      backgroundColor: colors.error,
    }} /> : null}
  </View>
}
