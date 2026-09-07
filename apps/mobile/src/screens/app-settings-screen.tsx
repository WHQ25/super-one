import { ScrollView, View } from 'react-native'
import { Settings2 } from 'lucide-react-native'
import { Text } from '../ui/text'
import { useMobileStyles, useMobileTheme } from '../theme/context'

/**
 * App settings — a placeholder until the real page lands.
 *
 * It is deliberately not the old project-settings screen under a new name: every
 * project-scoped control it held is already on the chat surface (model, effort,
 * permission mode, sandbox) or the new-session landing (harness, branch,
 * worktree), which is why that screen was removed rather than moved.
 */
export function AppSettingsScreen() {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <View style={styles.emptyState}>
        <Settings2 color={tokens.colors.border} size={48} />
        <Text style={styles.emptyTitle}>Settings</Text>
        <Text style={styles.emptyBody}>App preferences will live here.</Text>
      </View>
    </ScrollView>
  )
}
