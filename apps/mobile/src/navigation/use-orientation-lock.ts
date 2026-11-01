import { useEffect } from 'react'
import { Dimensions } from 'react-native'
import * as ScreenOrientation from 'expo-screen-orientation'
import type { HingePosture } from '../layout-state'
import { shouldAllowLandscape } from '../orientation-policy'

/**
 * The last decision actually sent to ScreenOrientation.
 *
 * Kept on the module, not the effect. A turn remounts the tree, and a fresh
 * effect would ask again. On iOS 27 that ask runs attemptRotationToDeviceOrientation
 * even when the geometry update is refused, which cancels the turn SpringBoard
 * just started and snaps the scene back to portrait.
 */
let appliedLandscape: boolean | undefined

/**
 * Applies the orientation policy for the lifetime of the app.
 *
 * Phones are locked to portrait; tablets and an open Duo rotate freely. The
 * Duo lock is the closed hinge, not the window size: the hinge leaves closed
 * while the cover is still on screen, and that is when the portrait lock has
 * to drop. Opening file preview unlocks rotation too — that surface has no
 * composer to cover. Each decision is sent once: repeating an unlock is what
 * puts a foldable back into portrait in the middle of a turn.
 */
export function useOrientationLock(options: { filePreviewOpen?: boolean; hinge?: HingePosture } = {}): void {
  const filePreviewOpen = options.filePreviewOpen === true
  const hinge = options.hinge ?? 'unknown'
  useEffect(() => {
    const apply = () => {
      const allow = shouldAllowLandscape(Dimensions.get('screen'), filePreviewOpen, hinge)
      if (allow === appliedLandscape) return
      appliedLandscape = allow
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
  }, [filePreviewOpen, hinge])
}
