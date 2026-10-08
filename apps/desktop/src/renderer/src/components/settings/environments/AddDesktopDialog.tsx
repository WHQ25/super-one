import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Loader2 } from 'lucide-react'
import {
  NodePairingCodeError,
  decodeNodePairingCode,
  type NodePairingCode,
} from '@superone/shared/environment/node-pairing-code'
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
import { Textarea } from '@superone/ui/components/ui/textarea'
import { classifyPairDesktopError } from './pair-desktop-error'

interface AddDesktopDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: () => void
}

type Decoded = { code: NodePairingCode } | { error: string } | null

/** `Studio.local` → `Studio`: the node's advertised host is its machine name. */
function defaultLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/\.local$/i, '')
  } catch {
    return url
  }
}

function pairingCodeMessage(err: unknown, t: TFunction): string {
  if (!(err instanceof NodePairingCodeError)) return err instanceof Error ? err.message : String(err)
  if (err.code === 'expired') return t('settings.remote.addDesktop.errors.expired')
  if (err.code === 'unsupported_version') return t('settings.remote.addDesktop.errors.unsupportedVersion')
  return t('settings.remote.addDesktop.errors.invalid')
}

/**
 * Pair another SuperOne desktop from the pairing code it shows under Remote
 * Control. The code carries the node URL, a single-use token and the
 * encrypted-channel credential; nothing in it is logged.
 */
export function AddDesktopDialog({ open, onOpenChange, onAdded }: AddDesktopDialogProps) {
  const { t } = useTranslation()
  const [codeText, setCodeText] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const decoded: Decoded = useMemo(() => {
    if (!codeText.trim()) return null
    try {
      return { code: decodeNodePairingCode(codeText, Date.now()) }
    } catch (err) {
      return { error: pairingCodeMessage(err, t) }
    }
  }, [codeText, t])

  const code = decoded && 'code' in decoded ? decoded.code : null

  function reset(): void {
    setCodeText('')
    setName('')
    setError('')
  }

  function handleOpenChange(next: boolean): void {
    if (busy) return
    if (!next) reset()
    onOpenChange(next)
  }

  async function submit(): Promise<void> {
    if (!code) return
    setBusy(true)
    setError('')
    try {
      // Re-check: the code may have expired while the dialog sat open.
      const fresh = decodeNodePairingCode(codeText, Date.now())
      const deviceLabel = await window.app.getHostname().catch(() => '')
      await window.environment.pairRemote({
        baseUrl: fresh.url,
        pairingToken: fresh.pairingToken,
        label: name.trim() || defaultLabel(fresh.url),
        deviceLabel: deviceLabel || undefined,
        channel: fresh.channel,
      })
      reset()
      onOpenChange(false)
      onAdded()
    } catch (err) {
      if (err instanceof NodePairingCodeError) {
        setError(pairingCodeMessage(err, t))
      } else {
        const message = err instanceof Error ? err.message : String(err)
        const failure = classifyPairDesktopError(message)
        setError(failure ? t(`settings.remote.addDesktop.errors.${failure}`, { url: code.url }) : message)
      }
    } finally {
      setBusy(false)
    }
  }

  const fieldError = decoded && 'error' in decoded ? decoded.error : ''

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('settings.remote.addDesktop.title')}</DialogTitle>
          <DialogDescription>{t('settings.remote.addDesktop.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="desktop-pairing-code">{t('settings.remote.addDesktop.codeLabel')}</Label>
            <Textarea
              id="desktop-pairing-code"
              className="min-h-20 break-all font-mono text-xs"
              placeholder={t('settings.remote.addDesktop.codePlaceholder')}
              spellCheck={false}
              autoComplete="off"
              value={codeText}
              disabled={busy}
              aria-invalid={!!fieldError}
              onChange={(e) => {
                setCodeText(e.target.value)
                setError('')
              }}
            />
            {fieldError && <p className="text-xs text-destructive break-words">{fieldError}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="desktop-pairing-name">{t('settings.remote.addDesktop.nameLabel')}</Label>
            <Input
              id="desktop-pairing-name"
              value={name}
              disabled={busy}
              placeholder={code ? defaultLabel(code.url) : ''}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('settings.remote.addDesktop.nameHint')}</p>
          </div>
        </div>

        {error && <p className="text-xs text-destructive break-words" role="alert">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={!code || busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t('settings.remote.addDesktop.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
