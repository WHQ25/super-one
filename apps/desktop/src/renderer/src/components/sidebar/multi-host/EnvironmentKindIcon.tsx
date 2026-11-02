import { Cloud, Monitor, Wifi } from 'lucide-react'
import type { NodeLinkPath } from '@superone/shared/environment/node-route'
import { cn } from '@superone/ui/lib/utils'
import type { EnvironmentConnection, EnvironmentKind } from '@/lib/multi-host/types'

/**
 * This machine is a monitor. A remote node or desktop shows how it is reached:
 * Wi-Fi on the LAN, a cloud through relay, SSH or Tailscale, and a red cloud
 * while it is offline.
 */
export function EnvironmentKindIcon({
  kind,
  connection,
  path,
  className = 'size-3.5 shrink-0',
}: {
  kind: EnvironmentKind
  connection?: EnvironmentConnection
  path?: NodeLinkPath
  className?: string
}) {
  if (kind === 'local') return <Monitor className={className} aria-hidden />
  if (connection === 'offline') return <Cloud className={cn(className, 'text-error')} aria-hidden />
  if (path === 'lan') return <Wifi className={className} aria-hidden />
  return <Cloud className={className} aria-hidden />
}

const UPGRADING_BARS = 12

/**
 * Replaces the kind glyph while this desktop is installing the node's CLI.
 * Same 12 fading bars as the loading toast, sized to the sidebar icon slot.
 */
export function EnvironmentUpgradingIcon({
  label,
  className,
}: {
  label: string
  className?: string
}) {
  return (
    <span
      role="img"
      aria-label={label}
      data-slot="environment-upgrading"
      className={cn('environment-upgrading size-4 shrink-0 text-sidebar-foreground/70', className)}
    >
      <span className="environment-upgrading-spinner">
        {Array.from({ length: UPGRADING_BARS }, (_, index) => (
          <span
            key={index}
            className="environment-upgrading-bar"
            style={{
              animationDelay: `${(-1.2 + index * 0.1).toFixed(1)}s`,
              transform: `rotate(${index === 0 ? 0.0001 : index * 30}deg) translate(146%)`,
            }}
          />
        ))}
      </span>
    </span>
  )
}
