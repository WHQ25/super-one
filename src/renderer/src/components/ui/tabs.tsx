import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"
import { motion } from "motion/react"

import { cn } from "@/lib/utils"

type TabsVariant = "default" | "sidebar"

const TabsValueContext = React.createContext<string | undefined>(undefined)
const TabsVariantContext = React.createContext<TabsVariant>("default")

function Tabs({ value, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsValueContext.Provider value={value}>
      <TabsPrimitive.Root data-slot="tabs" value={value} {...props} />
    </TabsValueContext.Provider>
  )
}

function TabsList({
  className,
  variant = "default",
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {
  variant?: TabsVariant
}) {
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
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.List
        ref={listRef}
        data-slot="tabs-list"
        className={cn(
          "relative flex items-center rounded-md p-0.5",
          variant === "sidebar"
            ? "border border-sidebar-border bg-sidebar-accent/30"
            : "border border-border bg-muted/50",
          className
        )}
        {...props}
      >
        {indicator && (
          <motion.div
            className={cn(
              "absolute rounded shadow-sm",
              variant === "sidebar" ? "bg-sidebar" : "bg-background"
            )}
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
    </TabsVariantContext.Provider>
  )
}

function TabsTrigger({
  className,
  variant: variantProp,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & {
  variant?: TabsVariant
}) {
  const ctxVariant = React.useContext(TabsVariantContext)
  const variant = variantProp ?? ctxVariant

  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative z-10 inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        variant === "sidebar"
          ? "text-sidebar-foreground/50 hover:text-sidebar-foreground data-[state=active]:text-sidebar-accent-foreground"
          : "text-muted-foreground hover:text-foreground data-[state=active]:text-foreground",
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
