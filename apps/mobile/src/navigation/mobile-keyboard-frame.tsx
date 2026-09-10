import type { PropsWithChildren } from 'react'
import { KeyboardAvoidingView, Platform, View } from 'react-native'
import { useKeyboardHeight } from '../ui/use-keyboard-visible'
import { useMobileStyles } from '../theme/context'

/**
 * Keeps the active native-stack scene above the software keyboard.
 *
 * This must sit outside the navigator. A KeyboardAvoidingView inside a native-stack
 * scene receives the keyboard event but the screen container keeps its original
 * frame, leaving the composer behind the keyboard.
 *
 * iOS uses `KeyboardAvoidingView`'s padding mode. Android does **not** use the
 * component at all: its `height` mode keeps two pieces of internal state — the
 * first frame height it ever measured and the last keyboard offset — and both
 * survive a keyboard cycle once the view is disabled (`_setBottom` skips
 * `setState` while `enabled` is false). Rotate a phone after typing in portrait
 * and a layout pass re-applies `portraitFrame - portraitKeyboard` with `flex: 0`
 * to a landscape window, pushing the composer and the sidebar footer off screen.
 * Padding the frame by the live keyboard height has no such memory: the window
 * is edge-to-edge and does not resize for the IME, so the padding is exactly the
 * space the keyboard covers, and it is `0` the moment the keyboard is down.
 */
export function MobileKeyboardFrame({ children }: PropsWithChildren) {
  const styles = useMobileStyles()
  if (Platform.OS === 'ios') {
    return (
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        {children}
      </KeyboardAvoidingView>
    )
  }
  return <AndroidKeyboardFrame>{children}</AndroidKeyboardFrame>
}

/** Android half: a plain flex container padded by the current keyboard height. */
function AndroidKeyboardFrame({ children }: PropsWithChildren) {
  const styles = useMobileStyles()
  const keyboardHeight = useKeyboardHeight()
  return (
    <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
      {children}
    </View>
  )
}
