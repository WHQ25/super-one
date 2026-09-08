import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'

/**
 * Whether the software keyboard is up.
 *
 * The bottom safe-area inset does not shrink when the keyboard covers it, so a
 * surface that rests on that inset cannot tell the two states apart by geometry
 * alone: with the keyboard down the inset *is* the gap, and with it raised the
 * inset is hidden behind the keyboard and the gap is the surface's to give.
 *
 * iOS emits the `Will` pair at the start of the keyboard animation, so layout
 * moves with it; Android only ever emits `Did`.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(() => !!Keyboard.metrics())
  useEffect(() => {
    const ios = Platform.OS === 'ios'
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setVisible(true))
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setVisible(false))
    return () => { show.remove(); hide.remove() }
  }, [])
  return visible
}
