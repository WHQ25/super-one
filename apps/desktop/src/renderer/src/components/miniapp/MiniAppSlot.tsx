import { useEffect, useLayoutEffect, useRef } from 'react'
import { useMiniAppStore } from '@/stores/miniapp'

interface MiniAppSlotProps {
  appId: string
  mode: 'panel' | 'canvas'
  className?: string
}

export function MiniAppSlot({ appId, mode, className }: MiniAppSlotProps) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const updateSlot = useMiniAppStore.getState().updateSlot
    const unregisterSlot = useMiniAppStore.getState().unregisterSlot

    let rafId = 0
    const schedule = () => {
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        const rect = el.getBoundingClientRect()
        updateSlot(appId, mode, rect)
      })
    }

    schedule()

    const ro = new ResizeObserver(schedule)
    ro.observe(el)

    const onWindowChange = () => schedule()
    window.addEventListener('resize', onWindowChange)
    window.addEventListener('scroll', onWindowChange, true)

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      ro.disconnect()
      window.removeEventListener('resize', onWindowChange)
      window.removeEventListener('scroll', onWindowChange, true)
      unregisterSlot(appId, mode)
    }
  }, [appId, mode])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const updateSlot = useMiniAppStore.getState().updateSlot
    let rafId = 0
    let last = el.getBoundingClientRect()
    const tick = () => {
      const cur = el.getBoundingClientRect()
      if (cur.left !== last.left || cur.top !== last.top || cur.width !== last.width || cur.height !== last.height) {
        last = cur
        updateSlot(appId, mode, cur)
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [appId, mode])

  return <div ref={ref} className={className} />
}
