import logoUrl from '@/assets/logo-text-inline.png'

const isWindows = window.app.platform === 'win32'

export function WindowsTitleBar(): React.JSX.Element | null {
  if (!isWindows) return null
  return (
    <div
      className="flex h-10 shrink-0 items-center border-b border-sidebar-border bg-sidebar pl-3"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <img src={logoUrl} alt="SuperOne" draggable={false} className="h-[18px] w-auto select-none" />
    </div>
  )
}
