import { useEffect } from 'react'
import App from '../App'
import { beginUnfold, syncWindowMiniModeFromMain, useWindowMiniModeStore } from '@/stores/window-mini-mode'

/**
 * Root for a full app window, including one converted into a mini window in place.
 *
 * The App tree deliberately stays mounted for every mini phase. Replacing it with a
 * second MiniWindowApp remounted SessionPane, reset layout/scroll observers and faded
 * two differently painted surfaces across each other — the flash at both endpoints.
 * App now changes only its surrounding shell, so the live chat DOM survives intact.
 */
export function RootApp(): React.JSX.Element {
  const phase = useWindowMiniModeStore((s) => s.phase)

  useEffect(() => window.app.onWindowMiniModeChanged(syncWindowMiniModeFromMain), [])

  useEffect(() => {
    void window.app.getWindowMiniMode().then((current) => {
      if (current) syncWindowMiniModeFromMain(current)
    })
  }, [])

  useEffect(() => {
    if (phase !== 'unfolding') return
    // App is already mounted; one frame is enough for the mini shell state to commit
    // before main starts growing the native window.
    const raf = requestAnimationFrame(beginUnfold)
    return () => cancelAnimationFrame(raf)
  }, [phase])

  return (
    // No background of its own: liquid glass needs an unbroken transparent chain from
    // `body` down to the shell, and the app root is what paints the window surface.
    <div className="relative h-screen w-screen overflow-hidden">
      <div className="absolute inset-0">
        <App />
      </div>
    </div>
  )
}
