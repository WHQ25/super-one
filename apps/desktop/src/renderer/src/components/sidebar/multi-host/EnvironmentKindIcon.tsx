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
