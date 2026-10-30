import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Cloud, Laptop, Link2, Monitor, Network, Pencil, Server, Smartphone, SquareTerminal, Terminal, Trash2, Wifi, type LucideIcon } from 'lucide-react'
import type { NodeLinkPath } from '@superone/shared/environment/node-route'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Switch } from '@superone/ui/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { cn } from '@superone/ui/lib/utils'
import { settingsRowClassName } from './SettingsSection'

export type DeviceKind = 'mac' | 'pc' | 'linux' | 'phone' | 'server'

const KIND_ICONS: Record<DeviceKind, LucideIcon> = {
  mac: Laptop,
  pc: Monitor,
  linux: SquareTerminal,
  phone: Smartphone,
  server: Server,
}

const PATH_ICONS: Record<NodeLinkPath, LucideIcon> = {
  lan: Wifi,
  tailscale: Network,
  relay: Cloud,
  ssh: Terminal,
  direct: Link2,
}

/** A computer's kind from its OS (`process.platform`); unknown ones show as a PC. */
export function computerKind(os: string | null | undefined): DeviceKind {
  if (os === 'darwin') return 'mac'
  if (os === 'linux') return 'linux'
  return 'pc'
}

/**
 * One paired device in Remote Control, the same on both tabs: what it is, how
 * it is connected now, and its actions. `access` is the device's own switch;
 * `accessLocked` (Allow Control off) shows it off and disabled whatever it holds.
 */
export function DeviceRow(props: {
  kind: DeviceKind
  name: string
  online: boolean
  /** Muted text under the name: when it was last seen, why it cannot connect. */
  status?: ReactNode
  statusTone?: 'muted' | 'warning' | 'error'
  /** Hover text explaining the status. */
  statusTitle?: string
  path?: NodeLinkPath | null
  /** Buttons before Remove (connect, retry, …). */
  actions?: ReactNode
  /** Pencil before those buttons. Edits the name this computer shows. */
  rename?: {
    label: string
    disabled?: boolean
    onSubmit: (name: string) => void | Promise<void>
  }
  /** Omit both to hide Remove. The local environment has no forget action. */
  removeLabel?: string
  onRemove?: () => void
  removeDisabled?: boolean
  access?: { enabled: boolean; label: string; onChange: (enabled: boolean) => void }
  accessLocked?: boolean
  /** Notes under the row (errors, upgrades). */
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const Icon = KIND_ICONS[props.kind]
  const kindLabel = t(`settings.remote.deviceKind.${props.kind}`)
  const shownEnabled = props.access ? props.access.enabled && !props.accessLocked : true
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(props.name)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const editingRef = useRef(false)
  const savingRef = useRef(false)
  /**
   * Chromium often reports `isComposing=false` on the Enter that confirms an
   * IME candidate. Keep our own flag and clear it one frame late.
   */
  const imeComposingRef = useRef(false)
  useEffect(() => {
    if (!editing) setDraft(props.name)
  }, [editing, props.name])
  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  function closeRename(): void {
    editingRef.current = false
    setEditing(false)
  }

  async function commitRename(): Promise<void> {
    if (!editingRef.current || savingRef.current) return
    const next = draft.trim()
    if (!next || next === props.name) {
      closeRename()
      return
    }
    savingRef.current = true
    setSaving(true)
    try {
      await props.rename?.onSubmit(next)
      closeRename()
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <div className={settingsRowClassName}>
      <div className="flex items-center gap-3">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
          title={kindLabel}
          aria-label={kindLabel}
          role="img"
        >
          <Icon className="size-4" />
        </span>
        <div className={cn('min-w-0 flex-1', !shownEnabled && 'opacity-60')}>
          <div className="flex min-w-0 items-center gap-2">
            {editing ? (
              <input
                ref={inputRef}
                className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                value={draft}
                maxLength={80}
                disabled={saving}
                aria-label={props.rename?.label}
                onChange={(event) => setDraft(event.target.value)}
                onCompositionStart={() => { imeComposingRef.current = true }}
                onCompositionEnd={() => {
                  requestAnimationFrame(() => { imeComposingRef.current = false })
                }}
                onKeyDown={(event) => {
                  // keyCode 229 is the legacy marker for a key swallowed by an IME.
                  if (
                    imeComposingRef.current
                    || event.nativeEvent.isComposing
                    || event.keyCode === 229
                  ) return
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void commitRename()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    closeRename()
                  }
                }}
                onBlur={() => {
                  if (imeComposingRef.current) return
                  void commitRename()
                }}
              />
            ) : (
              <span className="truncate text-sm text-foreground">{props.name}</span>
            )}
            {props.online && props.path ? <PathMark path={props.path} /> : null}
          </div>
          {props.status ? (
            <p
              title={props.statusTitle}
              className={cn(
                'truncate text-xs',
                props.statusTone === 'warning'
                  ? 'text-warning'
                  : props.statusTone === 'error'
                    ? 'text-destructive'
                    : 'text-muted-foreground',
              )}
            >
              {props.status}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {props.rename ? (
            <IconButton
              size="md"
              tooltip={props.rename.label}
              disabled={props.rename.disabled || saving}
              onClick={() => {
                editingRef.current = true
                setEditing(true)
              }}
            >
              <Pencil />
            </IconButton>
          ) : null}
          {props.actions}
          {props.onRemove && props.removeLabel ? (
            <IconButton
              size="md"
              variant="destructive"
              tooltip={props.removeLabel}
              disabled={props.removeDisabled}
              onClick={props.onRemove}
            >
              <Trash2 />
            </IconButton>
          ) : null}
          {props.access ? (
            <Switch
              className="ml-1"
              checked={shownEnabled}
              disabled={props.accessLocked}
              onCheckedChange={props.access.onChange}
              aria-label={props.access.label}
            />
          ) : null}
        </div>
      </div>
      {props.children}
    </div>
  )
}

/** How the device is connected now, styled like the status icons atop Control This Device. */
function PathMark({ path }: { path: NodeLinkPath }) {
  const { t } = useTranslation()
  const PathIcon = PATH_ICONS[path]
  const label = `${t('settings.environments.path.label')}: ${t(`settings.environments.path.${path}`)}`
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex shrink-0 items-center" aria-label={label} role="img">
            <PathIcon className="size-3.5 text-success" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
