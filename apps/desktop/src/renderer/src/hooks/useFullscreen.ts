import { useState, useEffect } from 'react'

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    window.app.getFullscreen().then(setIsFullscreen)
    return window.app.onFullscreenChanged(setIsFullscreen)
  }, [])

  return isFullscreen
}
