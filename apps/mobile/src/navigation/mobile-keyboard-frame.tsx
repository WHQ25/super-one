import type { PropsWithChildren } from 'react'
import { KeyboardAvoidingView, Platform } from 'react-native'
import { useKeyboardVisible } from '../ui/use-keyboard-visible'
import { useMobileStyles } from '../theme/context'

/**
 * Keeps the active native-stack scene above the software keyboard.
 *
 * This must sit outside the navigator. A KeyboardAvoidingView inside a native-stack
 * scene receives the keyboard event but the screen container keeps its original
 * frame, leaving the composer behind the keyboard. iOS needs padding while
 * Android edge-to-edge windows need the container height reduced explicitly.
 *
 * Android must leave height mode entirely when the keyboard hides. Disabling
 * KeyboardAvoidingView only zeroes its offset: its height branch can still apply
 * the first measured height and `flex: 0`. That measurement can precede safe-area
 * layout, so restoring it places the composer below the current available frame.
 * Removing the behavior restores flex layout without remounting the navigator.
 */
export function MobileKeyboardFrame({ children }: PropsWithChildren) {
  const styles = useMobileStyles()
  const keyboardUp = useKeyboardVisible()
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : keyboardUp ? 'height' : undefined}
      enabled={Platform.OS !== 'android' || keyboardUp}
      style={styles.flex}
    >
      {children}
    </KeyboardAvoidingView>
  )
}
