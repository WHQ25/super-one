import type { ReactNode, Ref } from 'react'

type SidebarFrameProps = {
  open: boolean
  width: number
  outerRef?: Ref<HTMLDivElement>
  innerRef?: Ref<HTMLDivElement>
  children: ReactNode
}

export function SidebarFrame({ open, width, outerRef, innerRef, children }: SidebarFrameProps) {
  return (
    <div
      ref={outerRef}
      data-sidebar-outer=""
      className="relative shrink-0 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
      style={{ width: open ? width : 0 }}
    >
      <div ref={innerRef} data-sidebar-inner="" className="h-full" style={{ width }}>
        {children}
      </div>
    </div>
  )
}
