import type { PropsWithChildren } from 'react'
import { KeyboardAvoidingView, Platform } from 'react-native'
import { useMobileStyles } from '../theme/context'

/**
 * Keeps the active native-stack scene above the software keyboard.
 *
 * This must sit outside the navigator. A KeyboardAvoidingView inside a native-stack
 * scene receives the keyboard event but the screen container keeps its original
 * frame, leaving the composer behind the keyboard. iOS needs padding while
 * Android edge-to-edge windows need the container height reduced explicitly.
 */
export function MobileKeyboardFrame({ children }: PropsWithChildren) {
  const styles = useMobileStyles()
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.flex}
    >
      {children}
    </KeyboardAvoidingView>
  )
}
