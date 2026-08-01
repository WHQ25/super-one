import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Loader2, Server } from 'lucide-react'
import type { EnvironmentInstallProgress } from '@superone/shared/environment'
import { Button } from '@superone/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@superone/ui/components/ui/dialog'
import { Input } from '@superone/ui/components/ui/input'
import { Label } from '@superone/ui/components/ui/label'
import { cn } from '@superone/ui/lib/utils'

const DEFAULT_REMOTE_PORT = '7788'

/** Mirrors main `SshConfigHost` / preload listSshConfigHosts(). */
interface SshConfigHostEntry {
  alias: string
  hostName?: string
  user?: string
  port?: number
  identityFile?: string
  display: string
}

interface AddEnvironmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: (warnings: string[]) => void
}

/**
 * Over SSH: pick a Host from ~/.ssh/config (compact cards) + optional local dist upload.
 * Manual: free-form SSH (ports, identity, remote exec, …) or pair with an existing token.
 */
export function AddEnvironmentDialog({ open, onOpenChange, onAdded }: AddEnvironmentDialogProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'ssh' | 'manual'>('ssh')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<EnvironmentInstallProgress | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => window.environment.onInstallProgress(setProgress), [])

  const [sshHosts, setSshHosts] = useState<SshConfigHostEntry[]>([])
  const [sshHostsLoading, setSshHostsLoading] = useState(false)
  /** Selected Host alias from ~/.ssh/config (Known Hosts tab). */
  const [selectedAlias, setSelectedAlias] = useState<string | null>(null)

  /** Product default is npm registry; upload is for local dist / debug. */
  const [useLocalUpload, setUseLocalUpload] = useState(false)

  // Add New Host — basic SSH
  const [destination, setDestination] = useState('')
  const [sshPort, setSshPort] = useState('')
  const [identityFile, setIdentityFile] = useState('')
  const [sshLabel, setSshLabel] = useState('')

  // Advanced (optional node install path + port; local dist for dev)
  const [remoteExec, setRemoteExec] = useState('')
  const [remotePort, setRemotePort] = useState(DEFAULT_REMOTE_PORT)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setSshHostsLoading(true)
    void Promise.all([
      window.environment.listSshConfigHosts().catch(() => [] as SshConfigHostEntry[]),
      window.environment.listItems().catch(() => [] as Awaited<ReturnType<typeof window.environment.listItems>>),
    ])
      .then(([hosts, items]) => {
        if (cancelled) return
        // Hide Hosts already paired (destination stored as ssh-forward target).
        const used = new Set<string>()
        for (const item of items) {
          if (item.kind !== 'remote') continue
          for (const ep of item.endpointProfiles) {
            if (ep.kind === 'ssh-forward' && ep.target) {
              used.add(ep.target.trim())
            }
          }
          if (item.label) used.add(item.label.trim())
        }
        setSshHosts(hosts.filter((h) => !used.has(h.alias) && !used.has(h.display)))
      })
      .catch(() => {
        if (!cancelled) setSshHosts([])
      })
      .finally(() => {
        if (!cancelled) setSshHostsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  function reset(): void {
    setError('')
    setProgress(null)
    setShowAdvanced(false)
    setSelectedAlias(null)
    setUseLocalUpload(false)
    setDestination('')
    setRemoteExec('')
    setRemotePort(DEFAULT_REMOTE_PORT)
    setSshPort('')
    setIdentityFile('')
    setSshLabel('')
  }

  function handleOpenChange(next: boolean): void {
    if (busy) return
    if (!next) reset()
    onOpenChange(next)
  }

  async function submit(): Promise<void> {
    setBusy(true)
    setError('')
    setProgress(null)
    try {
      if (mode === 'ssh') {
        if (!selectedAlias) throw new Error(t('settings.environments.add.sshPickRequired'))
        const result = await window.environment.addOverSsh({
          // Host alias — system OpenSSH resolves User / Port / IdentityFile.
          destination: selectedAlias,
          installSource: useLocalUpload ? 'upload' : 'registry',
          label: selectedAlias,
        })
        onAdded(result.warnings)
      } else {
        const result = await window.environment.addOverSsh({
          destination: destination.trim(),
          remoteExec: remoteExec.trim() || undefined,
          installSource: useLocalUpload ? 'upload' : 'registry',
          remotePort: Number(remotePort) || undefined,
          sshPort: sshPort ? Number(sshPort) : undefined,
          identityFile: identityFile.trim() || undefined,
          label: sshLabel.trim() || undefined,
        })
        onAdded(result.warnings)
      }
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const canSubmit =
    mode === 'ssh' ? Boolean(selectedAlias) : destination.trim().length > 0

  const progressLabel = progress
    ? progress.phase === 'installing'
      ? `${t(`settings.environments.add.progress.${progress.step}`)}${progress.detail ? ` ${progress.detail}` : ''}`
      : t(`settings.environments.add.progress.${progress.phase}`)
    : ''

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('settings.environments.add.titleSsh')}</DialogTitle>
          <DialogDescription>{t('settings.environments.add.descriptionSsh')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <button
            type="button"
            onClick={() => setMode('ssh')}
            className={cn(
              'text-sm transition-colors',
              mode === 'ssh'
                ? 'font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t('settings.environments.add.knownHostsTab')}
          </button>
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={cn(
              'text-sm transition-colors',
              mode === 'manual'
                ? 'font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t('settings.environments.add.addNewHostTab')}
          </button>
        </div>

        {mode === 'ssh' ? (
          <div className="space-y-3">
            {sshHostsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : sshHosts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('settings.environments.add.sshHostsEmpty')}
              </p>
            ) : (
              <ul className="max-h-56 space-y-2 overflow-y-auto">
                {sshHosts.map((host) => {
                  const selected = selectedAlias === host.alias
                  return (
                    <li key={host.alias}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setSelectedAlias(host.alias)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors',
                          selected
                            ? 'border-ring bg-accent/40'
                            : 'border-border/80 bg-background/50 hover:bg-muted/40',
                        )}
                      >
                        <Server
                          className={cn(
                            'size-3.5 shrink-0',
                            selected ? 'text-foreground' : 'text-muted-foreground',
                          )}
                        />
                        <span className="truncate text-sm font-medium">{host.alias}</span>
                        <span className="min-w-0 truncate text-xs text-muted-foreground">
                          {host.display}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            {import.meta.env.DEV && (
              <label className="flex items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={useLocalUpload}
                  onChange={(e) => setUseLocalUpload(e.target.checked)}
                />
                {t('settings.environments.add.useLocalUpload')}
              </label>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Field
              id="env-destination"
              label={t('settings.environments.add.destination')}
              hint={t('settings.environments.add.destinationHint')}
              value={destination}
              onChange={setDestination}
              placeholder="superone@10.0.0.12"
            />
            <div className="grid grid-cols-2 gap-3">
              <Field
                id="env-ssh-port"
                label={t('settings.environments.add.sshPort')}
                value={sshPort}
                onChange={setSshPort}
                placeholder="22"
              />
              <Field
                id="env-identity"
                label={t('settings.environments.add.identityFile')}
                value={identityFile}
                onChange={setIdentityFile}
                placeholder="~/.ssh/id_ed25519"
              />
            </div>
            <Field
              id="env-ssh-label"
              label={t('settings.environments.add.label')}
              value={sshLabel}
              onChange={setSshLabel}
              placeholder={destination || 'linux-box'}
            />

            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronDown className={showAdvanced ? 'size-3 rotate-180' : 'size-3'} />
              {t('settings.environments.add.advanced')}
            </button>

            {showAdvanced && (
              <div className="space-y-3 border-l border-border pl-3">
                <Field
                  id="env-exec"
                  label={t('settings.environments.add.remoteExec')}
                  value={remoteExec}
                  onChange={setRemoteExec}
                  placeholder={t('settings.environments.add.autoDetected')}
                />
                <Field
                  id="env-remote-port"
                  label={t('settings.environments.add.remotePort')}
                  value={remotePort}
                  onChange={setRemotePort}
                  placeholder={DEFAULT_REMOTE_PORT}
                />
                {import.meta.env.DEV && (
                  <label className="flex items-center gap-2 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={useLocalUpload}
                      onChange={(e) => setUseLocalUpload(e.target.checked)}
                    />
                    {t('settings.environments.add.useLocalUpload')}
                  </label>
                )}
              </div>
            )}
          </div>
        )}

        {error && <p className="text-xs text-destructive break-words">{error}</p>}

        <DialogFooter className="sm:justify-between">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {busy && progressLabel && (
              <>
                <Loader2 className="size-3 animate-spin" />
                {progressLabel}
              </>
            )}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void submit()} disabled={!canSubmit || busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t('settings.environments.add.submit')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface FieldProps {
  id: string
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  autoComplete?: string
}

function Field({ id, label, hint, value, onChange, placeholder, type, autoComplete }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
