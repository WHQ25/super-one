import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react"
import { Button } from "./button"
import { IconButton } from "./icon-button"
import { cn } from "../../lib/utils"

/** Every MCP App state other than an available View: what is happening and what to do. */
export interface McpAppState {
  message: string
  icon?: ReactNode
  alert?: boolean
  action?: ReactNode
}

export function McpAppStateCard({ state }: { state: McpAppState }) {
  return <div data-mcp-app-state-card className="mb-2 flex min-h-[50px] min-w-0 items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs">
    <div className="flex min-w-0 items-center gap-2">
      {state.icon}
      <p role={state.alert ? "alert" : undefined} className={cn("min-w-0 break-words", state.alert ? "text-error" : "text-muted-foreground")}>{state.message}</p>
    </div>
    {state.action}
  </div>
}

/** The state card's one action. */
export function McpAppStateButton({ icon, label, disabled, onClick }: { icon: ReactNode; label: string; disabled?: boolean; onClick: () => void }) {
  return <Button data-mcp-app-action size="sm" variant="secondary" disabled={disabled} className="h-7 shrink-0 gap-1.5 px-2.5 text-xs" onClick={onClick}>{icon}{label}</Button>
}

/** The header's activate (or sign-in) action; it pulses when the View tried to call out while inactive. */
export function McpAppActivateButton({ emphasized, className, ...props }: ComponentProps<typeof IconButton> & { emphasized: boolean }) {
  return <IconButton data-mcp-app-activate data-emphasized={emphasized || undefined} size="xs" variant="ghost"
    className={cn(emphasized && "animate-pulse ring-2 ring-ring/50", className)} {...props} />
}

/** Drives `McpAppActivateButton.emphasized`: each call restarts a short pulse. */
export function useMcpAppEmphasis(): [boolean, () => void] {
  const [emphasized, setEmphasized] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const emphasize = useCallback(() => {
    setEmphasized(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setEmphasized(false), 1800)
  }, [])
  return [emphasized, emphasize]
}
