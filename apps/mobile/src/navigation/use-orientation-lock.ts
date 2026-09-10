import { useEffect } from 'react'
import { Dimensions } from 'react-native'
import * as ScreenOrientation from 'expo-screen-orientation'
import { shouldAllowLandscape } from '../orientation-policy'

/**
 * Applies the orientation policy for the lifetime of the app.
 *
 * Phones are locked to portrait; tablets and unfolded foldables rotate freely.
 * The physical screen size is re-evaluated on `Dimensions` change because a
 * foldable's screen grows when it opens and shrinks when it closes.
 */
export function useOrientationLock(): void {
  useEffect(() => {
    let applied: boolean | undefined
    const apply = () => {
      const allow = shouldAllowLandscape(Dimensions.get('screen'))
      if (allow === applied) return
      applied = allow
      const request = allow
        ? ScreenOrientation.unlockAsync()
        : ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
      // Locking is best-effort: a dev client without the native module, or a
      // platform that refuses the lock, must not take the app down.
      request.catch(() => {})
    }
    apply()
    const sub = Dimensions.addEventListener('change', apply)
    return () => sub.remove()
  }, [])
}
