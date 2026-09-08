import { LoadingOverlay } from '../ui/loading-overlay'
import type { RefObject } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import { WebView } from 'react-native-webview'
import { TERMINAL_VIEW_HTML } from '@superone/chat-view'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { Terminal } from 'lucide-react-native'
import { Button } from '../ui'
import { useMobileLocale } from '../i18n/context'

const TERMINAL_SOURCE = { html: TERMINAL_VIEW_HTML }

export function TerminalScreen(props: {
  webRef: RefObject<WebView | null>
  writable: boolean
  onWebMessage: (raw: string) => void
  onClaim: () => void
  onKey: (data: string) => void
}) {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
  const { t } = useMobileLocale()
  return (
    <View style={styles.flex}>
      <WebView
        ref={props.webRef}
        originWhitelist={['*']}
        source={TERMINAL_SOURCE}
        startInLoadingState
        renderLoading={() => <LoadingOverlay label={t('Loading terminal…')} />}
        style={[styles.flex, { backgroundColor: tokens.colors.background }]}
        containerStyle={{ backgroundColor: tokens.colors.background }}
        onMessage={(event) => props.onWebMessage(event.nativeEvent.data)}
      />
      <View style={{ paddingHorizontal: 16, paddingTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: tokens.colors.surface }}>
        <Terminal size={14} color={tokens.colors.mutedForeground} />
        <Text style={[styles.rowMeta, styles.flex]}>{t(props.writable ? 'Interactive terminal' : 'Read-only · another client has control')}</Text>
        {!props.writable ? <Button label="Take control" variant="secondary" onPress={props.onClaim} /> : null}
      </View>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        style={[styles.terminalToolbar, { backgroundColor: tokens.colors.surface }]}
        contentContainerStyle={[styles.terminalToolbarContent, { paddingHorizontal: 12 }]}
      >
        {[
          ['Esc', '\u001b'],
          ['Tab', '\t'],
          ['↑', '\u001b[A'],
          ['↓', '\u001b[B'],
          ['←', '\u001b[D'],
          ['→', '\u001b[C'],
          ['Ctrl-C', '\u0003'],
        ].map(([label, data]) => (
          <Pressable
            key={label}
            disabled={!props.writable}
            accessibilityRole="button"
            accessibilityLabel={`Terminal key ${label}`}
            style={[styles.terminalKey, { minHeight: 44, justifyContent: 'center' }, !props.writable ? styles.disabledControl : null]}
            onPress={() => props.onKey(data)}
          >
            <Text style={styles.secondaryBtnText}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}
