import { useRef } from 'react'
import logoUrl from '@/assets/logo-text-inline.png'
import { useWindowChromeSync } from '@/hooks/useWindowChromeSync'

const isWindows = window.app?.platform === 'win32'

export function WindowsTitleBar(): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  // The native caption buttons are drawn over the right end of this strip.
  useWindowChromeSync(ref)
  if (!isWindows) return null
  return (
    <div
      ref={ref}
      className="flex h-10 shrink-0 items-center bg-sidebar pl-3 text-sidebar-foreground"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <img src={logoUrl} alt="SuperOne" draggable={false} className="h-[18px] w-auto select-none" />
    </div>
  )
}
