import type { RefObject } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native'
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
}) {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <WebView
        ref={props.webRef}
        originWhitelist={['*']}
        source={{ html: TERMINAL_VIEW_HTML }}
        style={styles.flex}
        onMessage={(event) => props.onWebMessage(event.nativeEvent.data)}
      />
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
        <Pressable style={styles.send} onPress={props.onClaim}>
          <Text style={styles.btnText}>Claim</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}
