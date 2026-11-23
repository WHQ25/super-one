import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react'

const ComposerToolbarCompactContext = createContext(false)

export const ComposerToolbarCompactProvider = ComposerToolbarCompactContext.Provider

export function useComposerToolbarCompact() {
  return useContext(ComposerToolbarCompactContext)
}

export function useToolbarChipCompact(visible: boolean, labelKey: string) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const leftGroupRef = useRef<HTMLDivElement>(null)
  const rightGroupRef = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(false)
  const labelWidthRef = useRef(0)

  useLayoutEffect(() => {
    setCompact(false)
    labelWidthRef.current = 0
  }, [visible, labelKey])

  useLayoutEffect(() => {
    if (!visible) return
    const toolbar = toolbarRef.current
    const leftGroup = leftGroupRef.current
    const rightGroup = rightGroupRef.current
    if (!toolbar || !leftGroup) return

    const measure = () => {
      const available = toolbar.clientWidth
      if (available <= 0) return

      const rightWidth = rightGroup ? rightGroup.scrollWidth + 8 : 0
      const used = leftGroup.scrollWidth + rightWidth
      if (!compact) {
        const labels = leftGroup.querySelectorAll<HTMLElement>('[data-toolbar-chip-label]')
        if (labels.length > 0) {
          let total = 0
          labels.forEach((el) => {
            total += el.offsetWidth + 4
          })
          labelWidthRef.current = total
        }
        if (used > available) {
          setCompact(true)
        }
      } else if (labelWidthRef.current > 0 && used + labelWidthRef.current <= available) {
        setCompact(false)
      }
    }

    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(toolbar)
    observer.observe(leftGroup)
    if (rightGroup) observer.observe(rightGroup)
    return () => observer.disconnect()
  }, [visible, labelKey, compact])

  return { toolbarRef, leftGroupRef, rightGroupRef, compact }
}
