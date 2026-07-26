import { useState, useEffect } from 'react'

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    void window.app.getFullscreen?.().then(setIsFullscreen)
    const unsub = window.app.onFullscreenChanged?.(setIsFullscreen)
    return () => {
      if (typeof unsub === 'function') unsub()
    }
  }, [])

  return isFullscreen
}
