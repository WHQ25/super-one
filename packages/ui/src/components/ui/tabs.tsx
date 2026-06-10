import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"
import { motion } from "motion/react"

import { cn } from "../../lib/utils"

const TabsValueContext = React.createContext<string | undefined>(undefined)

function Tabs({ value, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsValueContext.Provider value={value}>
      <TabsPrimitive.Root data-slot="tabs" value={value} {...props} />
    </TabsValueContext.Provider>
  )
}

function TabsList({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  const currentValue = React.useContext(TabsValueContext)
  const listRef = React.useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = React.useState<{
    left: number
    width: number
    top: number
    height: number
  } | null>(null)
  const shouldAnimate = React.useRef(false)

  const measure = React.useCallback(() => {
    const list = listRef.current
    if (!list) return
    const active = list.querySelector<HTMLElement>('[data-state="active"]')
    if (active) {
      setIndicator({
        left: active.offsetLeft,
        width: active.offsetWidth,
        top: active.offsetTop,
        height: active.offsetHeight,
      })
    }
  }, [])

  React.useLayoutEffect(() => {
    shouldAnimate.current = indicator !== null
    measure()
  }, [currentValue, measure])

  React.useEffect(() => {
    const list = listRef.current
    if (!list) return
    const ro = new ResizeObserver(() => {
      shouldAnimate.current = false
      measure()
    })
    ro.observe(list)
    return () => ro.disconnect()
  }, [measure])

  return (
    <TabsPrimitive.List
      ref={listRef}
      data-slot="tabs-list"
      className={cn(
        "relative flex items-center rounded-md p-0.5",
        className
      )}
      {...props}
    >
      <div className="pointer-events-none absolute inset-x-0.5 inset-y-1 rounded-md bg-muted dark:bg-muted/50" />
      {indicator && (
        <motion.div
          className="absolute rounded-md border border-border bg-background shadow-sm"
          initial={false}
          animate={{
            left: indicator.left,
            width: indicator.width,
          }}
          style={{ top: indicator.top, height: indicator.height }}
          transition={shouldAnimate.current
            ? { type: "spring", bounce: 0.15, duration: 0.3 }
            : { duration: 0 }
          }
        />
      )}
      {children}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative z-10 inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        "text-muted-foreground hover:text-foreground data-[state=active]:text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </TabsPrimitive.Trigger>
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
