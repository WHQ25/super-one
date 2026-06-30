import { useEffect, useRef, useState } from 'react'

export function useGlobalDragging(): boolean {
  const [dragging, setDragging] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const clear = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
      setDragging(false)
    }
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) return
      setDragging(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(clear, 150)
    }
    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('drop', clear, true)
    window.addEventListener('dragend', clear, true)
    return () => {
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('drop', clear, true)
      window.removeEventListener('dragend', clear, true)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return dragging
}
