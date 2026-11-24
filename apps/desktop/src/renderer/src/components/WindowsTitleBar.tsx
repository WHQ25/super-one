import { useRef } from 'react'
import { SlotSingle, useSlotVersion } from '@superone/ui-slots/react'
import { PluginSlotErrorBoundary } from '@/lib/ui-slots'
import logoUrl from '@/assets/logo-text-inline.png'
import { useWindowChromeSync } from '@/hooks/useWindowChromeSync'
import { LayoutToggle } from '@/components/coding/LayoutToggle'

function DefaultTitlebarContent() {
  return <img src={logoUrl} alt="SuperOne" draggable={false} className="h-[18px] w-auto shrink-0 select-none" />
}

export function WindowsTitleBar({ showLayoutControls = false }: { showLayoutControls?: boolean }): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const titlebarSlotVersion = useSlotVersion('shell.titlebar.content')
  // The native caption buttons are drawn over the right end of this strip.
  useWindowChromeSync(ref)
  if (window.app?.platform !== 'win32') return null
  return (
    <div
      ref={ref}
      data-windows-titlebar=""
      className="flex h-10 shrink-0 items-center gap-3 bg-sidebar pl-3 pr-[138px] text-sidebar-foreground"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <PluginSlotErrorBoundary resetKey={String(titlebarSlotVersion)} fallback={() => <DefaultTitlebarContent />}>
        <SlotSingle
          name="shell.titlebar.content"
          props={{ showLayoutControls }}
          fallback={DefaultTitlebarContent}
        />
      </PluginSlotErrorBoundary>
      {showLayoutControls && <LayoutToggle placement="titlebar" />}
    </div>
  )
}
