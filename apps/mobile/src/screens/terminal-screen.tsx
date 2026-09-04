import type { RefObject } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { TERMINAL_VIEW_HTML } from '@superone/chat-view'
import { useMobileStyles, useMobileTheme } from '../theme/context'

export function TerminalScreen(props: {
  webRef: RefObject<WebView | null>
  draft: string
  writable: boolean
  onWebMessage: (raw: string) => void
  onDraft: (value: string) => void
  onSubmit: () => void
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
        source={{ html: TERMINAL_VIEW_HTML }}
        style={styles.flex}
        onMessage={(event) => props.onWebMessage(event.nativeEvent.data)}
      />
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        style={styles.terminalToolbar}
        contentContainerStyle={styles.terminalToolbarContent}
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
            style={[styles.terminalKey, !props.writable ? styles.disabledControl : null]}
            onPress={() => props.onKey(data)}
          >
            <Text style={styles.secondaryBtnText}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.composer}>
        <TextInput
          style={styles.composerInput}
          placeholder={props.writable ? 'terminal input' : 'read-only'}
          placeholderTextColor={tokens.colors.mutedForeground}
          value={props.draft}
          onChangeText={props.onDraft}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={props.onSubmit}
        />
        {!props.writable ? (
          <Pressable style={styles.send} onPress={props.onClaim}>
            <Text style={styles.btnText}>Claim</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}
