import { useEffect, useState } from 'react'

export function useSashResizing(): boolean {
  const [resizing, setResizing] = useState(false)

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('.dv-sash')) return
      setResizing(true)
      const stop = () => {
        setResizing(false)
        window.removeEventListener('pointerup', stop, true)
        window.removeEventListener('pointercancel', stop, true)
      }
      window.addEventListener('pointerup', stop, true)
      window.addEventListener('pointercancel', stop, true)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [])

  return resizing
}
