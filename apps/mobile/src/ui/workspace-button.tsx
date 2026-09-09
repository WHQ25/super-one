import { Menu } from 'lucide-react-native'
import { View } from 'react-native'
import { IconButton } from './icon-button'
import { Text } from './text'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'

export function WorkspaceButton({ pendingCount = 0, onPress }: { pendingCount?: number; onPress: () => void }) {
  const { tokens: { colors } } = useMobileTheme()
  const { locale } = useMobileLocale()
  const count = Math.max(0, Math.floor(pendingCount))
  const label = count ? locale === 'zh' ? `打开工作区，${count} 项待处理` : `Open workspace, ${count} pending requests` : 'Open workspace'
  return <View>
    <IconButton icon={Menu} label={label} onPress={onPress} />
    {count > 0 ? <View pointerEvents="none" accessible={false} style={{
      position: 'absolute', right: 0, top: 0, minWidth: 18, height: 18,
      paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.success,
    }}>
      <Text style={{ fontSize: 10, fontWeight: '700', color: colors.successForeground }}>{count > 99 ? '99+' : count}</Text>
    </View> : null}
  </View>
}
