import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Computer, Cpu, Folder, Laptop, Loader2, MemoryStick, Monitor, Pencil, Server } from 'lucide-react'
import type { NodeLinkPath } from '@superone/shared/environment/node-route'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { loadEnvironmentItems } from '@/lib/environment-list'
import type { EnvironmentConnection, EnvironmentKind } from '@/lib/multi-host/types'
import { EnvironmentKindIcon } from './EnvironmentKindIcon'
import { SessionHoverCardTrigger, SidebarHoverCard } from './SidebarHoverCard'
import { EnvironmentSettingsDialog } from './EnvironmentSettingsDialog'

/** Facts read when the card opens. Absent lines stay off the card. */
export interface EnvironmentHoverDetails {
  platform?: { os: string; arch: string }
  /** `EnvironmentMachine.os`, for example `macOS 26.0`. Preferred over `platform`. */
  machineOs?: string
  /** Installed memory, and free memory when the host reported it. */
  memory?: { totalBytes: number | null; freeBytes: number | null } | null
  /** One CPU sample, plus the chip name or core count from the machine descriptor. */
  cpu?: { percent?: number | null; model?: string; cores?: number } | null
}

const GIB = 1024 ** 3

/** Compact size, as in `32GB` or `512MB`. */
export function formatMemoryBytes(bytes: number): string {
  const gb = bytes / GIB
  if (gb >= 1) {
    const rounded = Math.round(gb * 10) / 10
    const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
    return `${text}GB`
  }
  return `${Math.max(1, Math.round(bytes / (1024 ** 2)))}MB`
}

/**
 * Free memory while the host is connected. Otherwise the installed total
 * saved from the last connection. Nothing, when neither is known.
 */
export function environmentMemoryLabel(
  memory: EnvironmentHoverDetails['memory'],
): { amount: string; free: boolean } | null {
  const freeBytes = memory?.freeBytes
  if (freeBytes != null && freeBytes >= 0) {
    return { amount: freeBytes === 0 ? '0MB' : formatMemoryBytes(freeBytes), free: true }
  }
  const totalBytes = memory?.totalBytes
  if (totalBytes != null && totalBytes > 0) return { amount: formatMemoryBytes(totalBytes), free: false }
  return null
}

function asPercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(100, Math.max(0, Math.round(value)))
}

function asSample(value: unknown): { memory: EnvironmentHoverDetails['memory']; cpuPercent: number | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { memory: null, cpuPercent: null }
  const row = value as { totalBytes?: unknown; freeBytes?: unknown; cpuPercent?: unknown }
  const totalBytes = typeof row.totalBytes === 'number' ? row.totalBytes : null
  const freeBytes = typeof row.freeBytes === 'number' ? row.freeBytes : null
  const cpuPercent = asPercent(row.cpuPercent)
  return {
    memory: totalBytes == null && freeBytes == null ? null : { totalBytes, freeBytes },
    cpuPercent,
  }
}

export function environmentSystemLabel(details: EnvironmentHoverDetails | null | undefined): string | null {
  if (!details) return null
  if (details.machineOs) return details.machineOs
  const platform = details.platform
  if (!platform) return null
  const os = platform.os === 'darwin'
    ? 'macOS'
    : platform.os === 'windows' || platform.os === 'win32'
      ? 'Windows'
      : platform.os === 'linux'
        ? 'Linux'
        : platform.os
  return platform.arch ? `${os} · ${platform.arch}` : os
}

/**
 * Read system, memory, and one CPU sample when the card is open.
 * `undefined` is still loading; `null` means nothing more was reported.
 */
export function useEnvironmentHoverDetails(
  connectionId: string | undefined,
  shown: boolean,
): EnvironmentHoverDetails | null | undefined {
  const [state, setState] = useState<{ id: string; details: EnvironmentHoverDetails | null } | null>(null)
  useEffect(() => {
    if (!shown || !connectionId) return
    let cancelled = false
    const listItems = window.environment?.listItems
    const readMemory = window.environment?.memory
    if (!listItems) {
      setState({ id: connectionId, details: null })
      return
    }
    void Promise.all([
      listItems(),
      typeof readMemory === 'function' ? readMemory(connectionId).then(asSample).catch(() => null) : Promise.resolve(null),
    ]).then(([items, sample]) => {
      if (cancelled) return
      const item = items.find((row) => row.connectionId === connectionId)
      const cpu = {
        percent: sample?.cpuPercent ?? null,
        model: item?.machine?.cpuModel,
        cores: item?.machine?.cpuCores,
      }
      const hasCpu = cpu.percent != null || !!cpu.model?.trim() || (cpu.cores ?? 0) > 0
      const storedTotal = item?.machine?.memoryBytes
      const memory = sample?.memory?.freeBytes != null
        ? sample.memory
        : storedTotal
          ? { totalBytes: storedTotal, freeBytes: null }
          : sample?.memory
      setState({
        id: connectionId,
        details: item || memory || hasCpu
          ? {
              platform: item?.platform,
              machineOs: item?.machine?.os,
              memory,
              ...(hasCpu ? { cpu } : {}),
            }
          : null,
      })
    }).catch(() => {
      if (!cancelled) setState({ id: connectionId, details: null })
    })
    return () => { cancelled = true }
  }, [shown, connectionId])
  if (!connectionId) return null
  if (!state || state.id !== connectionId) return undefined
  return state.details
}

/** Same three glyphs as an environment mention: this computer, a desktop, a node. */
function EnvironmentDeviceIcon({ kind, className }: { kind: EnvironmentKind; className?: string }) {
  const Icon = kind === 'local' ? Laptop : kind === 'remote-desktop' ? Monitor : Server
  return <Icon className={className} aria-hidden />
}

/**
 * How this card reached the machine. This computer has no path, so it uses a
 * computer glyph. The OS line keeps the monitor, and the sidebar row does too.
 */
function KindLineIcon({
  kind,
  connection,
  path,
}: {
  kind: EnvironmentKind
  connection: EnvironmentConnection
  path?: NodeLinkPath | null
}) {
  if (kind === 'local') return <Computer className="size-3" aria-hidden />
  return <EnvironmentKindIcon kind={kind} connection={connection} path={path ?? undefined} className="size-3" />
}

function cpuLine(
  cpu: EnvironmentHoverDetails['cpu'],
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  if (!cpu) return null
  const model = cpu.model?.trim()
  const name = model || ((cpu.cores ?? 0) > 0 ? t('sidebar.environmentHover.cpuCores', { count: cpu.cores }) : '')
  const percent = asPercent(cpu.percent)
  if (percent == null && !name) return null
  if (percent == null) return name
  if (!name) return t('sidebar.environmentHover.cpuPercent', { percent })
  return t('sidebar.environmentHover.cpu', { name, percent })
}

function HoverLine({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="flex h-4 shrink-0 items-center">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  )
}

export function EnvironmentHoverBody({
  label,
  kind,
  connection,
  path,
  projectCount = null,
  details,
  waiting = false,
  onEdit,
}: {
  label: string
  kind: EnvironmentKind
  connection: EnvironmentConnection
  path?: NodeLinkPath | null
  /** `null` until the project list has settled. */
  projectCount?: number | null
  details?: EnvironmentHoverDetails | null
  /** System, memory, and CPU are still being read. */
  waiting?: boolean
  onEdit?: () => void
}) {
  const { t } = useTranslation()
  const kindLabel = kind === 'local'
    ? t('sidebar.environmentHover.kindLocal')
    : kind === 'remote-desktop'
      ? t('sidebar.environmentHover.kindDesktop')
      : t('sidebar.environmentHover.kindNode')
  const statusLabel = connection === 'offline'
    ? t('sidebar.hover.offline')
    : connection === 'needs-upgrade'
      ? t('sidebar.hover.needsUpgrade')
      : connection === 'connecting'
        ? t('settings.environments.state.connecting')
        : t('settings.environments.state.connected')
  // This computer is always here. "Connected" only means something for a remote host.
  const kindLine = kind === 'local' && connection === 'connected'
    ? kindLabel
    : `${kindLabel} · ${statusLabel}`
  const system = environmentSystemLabel(details)
  const memory = environmentMemoryLabel(details?.memory)
  const cpu = cpuLine(details?.cpu, t)
  return (
    <div className="flex flex-col gap-2 text-xs" data-environment-hover>
      <div className="flex items-start gap-2">
        <span
          data-slot="environment-device-icon"
          className="mt-0.5 flex size-4 shrink-0 items-center text-muted-foreground"
          title={kindLabel}
        >
          <EnvironmentDeviceIcon kind={kind} className="size-4" />
        </span>
        <div className="line-clamp-3 min-w-0 flex-1 break-words text-sm font-medium text-popover-foreground">{label}</div>
        {onEdit && (
          <IconButton size="sm" tooltip={t('sidebar.environmentSettings.title')} onClick={onEdit}>
            <Pencil />
          </IconButton>
        )}
      </div>
      <div className="flex flex-col gap-1 text-muted-foreground">
        <HoverLine icon={<KindLineIcon kind={kind} connection={connection} path={path} />}>
          <span className="block truncate">{kindLine}</span>
        </HoverLine>
        {projectCount != null && (
          <HoverLine icon={<Folder className="size-3" />}>
            <span className="block truncate">{t('sidebar.environmentHover.projects', { count: projectCount })}</span>
          </HoverLine>
        )}
        {waiting ? (
          <div className="flex items-center text-muted-foreground">
            <Loader2 aria-hidden className="size-3 animate-spin" />
          </div>
        ) : (
          <>
            {system && (
              <HoverLine icon={<Monitor className="size-3" />}>
                <span className="block truncate">{system}</span>
              </HoverLine>
            )}
            {cpu && (
              <HoverLine icon={<Cpu className="size-3" />}>
                <span className="block truncate">{cpu}</span>
              </HoverLine>
            )}
            {memory && (
              <HoverLine icon={<MemoryStick className="size-3" />}>
                <span className="block truncate">
                  {memory.free ? t('sidebar.environmentHover.memoryFree', { amount: memory.amount }) : memory.amount}
                </span>
              </HoverLine>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function EnvironmentHoverCard({
  open,
  label,
  kind,
  connection,
  path,
  projectCount,
  connectionId,
  details,
  onRename,
  children,
}: {
  /** Stories pin the card open. */
  open?: boolean
  label: string
  kind: EnvironmentKind
  connection: EnvironmentConnection
  path?: NodeLinkPath
  projectCount?: number | null
  connectionId?: string
  /** Skips the list read. Stories pass the lines they draw. */
  details?: EnvironmentHoverDetails
  onRename?: (name: string) => Promise<void>
  children: ReactNode
}) {
  const [hovered, setHovered] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const shown = (open ?? hovered) && !settingsOpen
  const fetched = useEnvironmentHoverDetails(details ? undefined : connectionId, shown)
  const facts = details ?? fetched
  const waiting = shown && details == null && connectionId != null && fetched === undefined
  return (
    <>
      <SidebarHoverCard
        open={shown}
        onOpenChange={(next) => {
          if (open == null) setHovered(next)
        }}
        content={(
          <EnvironmentHoverBody
            label={label}
            kind={kind}
            connection={connection}
            path={path}
            projectCount={projectCount}
            details={facts}
            waiting={waiting}
            onEdit={onRename ? () => setSettingsOpen(true) : undefined}
          />
        )}
      >
        <SessionHoverCardTrigger>{children}</SessionHoverCardTrigger>
      </SidebarHoverCard>
      {onRename && (
        <EnvironmentSettingsDialog
          open={settingsOpen}
          name={label}
          onOpenChange={setSettingsOpen}
          onSubmit={onRename}
        />
      )}
    </>
  )
}
