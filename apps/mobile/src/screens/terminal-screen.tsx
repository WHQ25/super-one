import { LoadingOverlay } from '../ui/loading-overlay'
import type { RefObject } from 'react'
import { Pressable, ScrollView, TextInput, View } from 'react-native'
import { Text } from '../ui/text'
import { WebView } from 'react-native-webview'
import { TERMINAL_VIEW_HTML } from '@superone/chat-view'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { ArrowUp, Terminal } from 'lucide-react-native'
import { Button, IconButton } from '../ui'

const TERMINAL_SOURCE = { html: TERMINAL_VIEW_HTML }

export function TerminalScreen(props: {
  webRef: RefObject<WebView | null>
  draft: string
  writable: boolean
  onWebMessage: (raw: string) => void
  onDraft: (value: string) => void
  onSubmit: (value: string) => void
  onClaim: () => void
  onKey: (data: string) => void
}) {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
  return (
    <View style={styles.flex}>
      <WebView
        ref={props.webRef}
        originWhitelist={['*']}
        source={TERMINAL_SOURCE}
        startInLoadingState
        renderLoading={() => <LoadingOverlay label="Loading terminal…" />}
        style={styles.flex}
        onMessage={(event) => props.onWebMessage(event.nativeEvent.data)}
      />
      <View style={{ paddingHorizontal: 16, paddingTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: tokens.colors.surface }}>
        <Terminal size={14} color={tokens.colors.mutedForeground} />
        <Text style={styles.rowMeta}>{props.writable ? 'Interactive terminal' : 'Read-only · another client has control'}</Text>
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
      <View style={[styles.composer, { paddingHorizontal: 12, backgroundColor: tokens.colors.surface }]}>
        <TextInput
          accessibilityLabel="Terminal input"
          editable={props.writable}
          style={styles.composerInput}
          placeholder={props.writable ? 'terminal input' : 'read-only'}
          placeholderTextColor={tokens.colors.mutedForeground}
          value={props.draft}
          onChangeText={props.onDraft}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={(event) => props.onSubmit(event.nativeEvent.text)}
        />
        {props.writable ? <IconButton icon={ArrowUp} label="Send terminal command" active disabled={!props.draft} onPress={() => props.onSubmit(props.draft)} />
          : <Button label="Take control" variant="secondary" onPress={props.onClaim} />}
      </View>
    </View>
  )
}
