import { ActivityIndicator, View } from 'react-native'
import { Plug } from 'lucide-react-native'
import { Text } from './text'
import { ComposerPanel } from './composer-panel'
import { useMobileTheme } from '../theme/context'
import type { McpServerRow } from '../mcp-status'
import { useMobileLocale } from '../i18n/context'

/**
 * What `/mcp` shows: which servers this session is running and whether they
 * are up.
 *
 * Read-only. The desktop popup can reconnect a server and start an OAuth
 * flow; a phone cannot finish one, and a button that begins something it
 * cannot complete is worse than a readout — so a server needing sign-in says
 * where to do it.
 */
export function McpPanel({ visible, servers, loading, error, onDismiss }: {
  visible: boolean
  servers: McpServerRow[]
  loading: boolean
  error?: string
  onDismiss: () => void
}) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  if (!visible) return null
  const dot = (tone: McpServerRow['tone']) =>
    tone === 'ok' ? colors.success : tone === 'warn' ? colors.warning
    : tone === 'bad' ? colors.error : colors.mutedForeground
  return <ComposerPanel title="MCP servers" icon={Plug} testID="mcp-panel" onClose={onDismiss}>
    {loading ? <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 }}>
      <ActivityIndicator size="small" color={colors.mutedForeground} />
      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{t('Reading server status…')}</Text>
    </View> : error ? <Text accessibilityRole="alert" style={{ padding: 8, color: colors.error, fontSize: 13 }}>{error}</Text>
    : !servers.length ? <Text style={{ padding: 8, color: colors.mutedForeground, fontSize: 13 }}>
      {/* An empty list is a fact about the session, not a failure. */}
      {t('This session has no MCP servers configured.')}
    </Text> : servers.map((server) => <View key={server.name}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4, paddingVertical: 6, minHeight: 44 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot(server.tone) }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: '500' }}>{server.name}</Text>
        <Text numberOfLines={2} style={{ color: colors.mutedForeground, fontSize: 12 }}>{server.detail}</Text>
      </View>
    </View>)}
  </ComposerPanel>
}
