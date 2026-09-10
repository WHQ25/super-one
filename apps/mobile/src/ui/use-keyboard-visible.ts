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

/**
 * Height of the software keyboard in dp, `0` while it is down.
 *
 * Read straight off the keyboard events rather than derived from a stored
 * frame: a value that has to be subtracted from a "first measured height"
 * goes stale the moment the window changes shape (rotation), which is how
 * `KeyboardAvoidingView`'s Android `height` mode ended up sizing a landscape
 * shell to a portrait frame minus a portrait keyboard.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(() => Keyboard.metrics()?.height ?? 0)
  useEffect(() => {
    const ios = Platform.OS === 'ios'
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow',
      (event) => setHeight(event.endCoordinates.height))
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setHeight(0))
    return () => { show.remove(); hide.remove() }
  }, [])
  return height
}
