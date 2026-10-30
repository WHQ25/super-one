import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { useScrollEdgeFade } from "../../lib/use-scroll-edge-fade"
import { cn } from "../../lib/utils"

function assignRef(ref: React.Ref<HTMLDivElement> | undefined, node: HTMLDivElement | null) {
  if (typeof ref === "function") ref(node)
  else if (ref) ref.current = node
}

function ScrollArea({
  className,
  children,
  viewportRef,
  edgeFade = false,
  onScroll,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  viewportRef?: React.Ref<HTMLDivElement>
  /** Fade the top and bottom while this viewport is scrolled. */
  edgeFade?: boolean
}) {
  const viewportRefProp = React.useRef(viewportRef)
  viewportRefProp.current = viewportRef
  const fadeRef = useScrollEdgeFade<HTMLDivElement>(edgeFade)
  const setViewport = React.useCallback((node: HTMLDivElement | null) => {
    fadeRef(node)
    assignRef(viewportRefProp.current, node)
  }, [fadeRef])

  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={setViewport}
        onScroll={onScroll}
        data-slot="scroll-area-viewport"
        className={cn(
          "focus-visible:ring-ring/50 size-full min-w-0 rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1",
          edgeFade && "scroll-edge-fade-y",
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" &&
          "h-full w-2.5",
        orientation === "horizontal" &&
          "h-2.5 flex-col",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="bg-border relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
