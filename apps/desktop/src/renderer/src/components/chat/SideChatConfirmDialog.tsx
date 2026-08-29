import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Checkbox } from '@superone/ui/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import { setSkipCloseConfirm, useSideChatStore } from '@/stores/side-chat'

/**
 * The one warning a side chat gets before it is thrown away.
 *
 * Mounted once at the app root rather than beside a trigger, because both things
 * that destroy a side chat — the tab's X and opening a second one — live in
 * different trees, and the store resolves whichever asked.
 */
export function SideChatConfirmDialog() {
  const { t } = useTranslation()
  const confirm = useSideChatStore((s) => s.confirm)
  const resolveConfirm = useSideChatStore((s) => s.resolveConfirm)
  const [dontAsk, setDontAsk] = useState(false)

  const kind = confirm?.kind
  // Reset per opening: the box is a decision about *this* prompt until confirmed,
  // and a stale tick would silence the next one without the user asking for it.
  useEffect(() => { if (confirm) setDontAsk(false) }, [confirm])

  const answer = (confirmed: boolean) => {
    if (confirmed && kind === 'close' && dontAsk) setSkipCloseConfirm()
    resolveConfirm(confirmed)
  }

  return (
    <Dialog open={!!confirm} onOpenChange={(open) => { if (!open) answer(false) }}>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {kind === 'replace' ? t('sideChat.replaceConfirm.title') : t('sideChat.closeConfirm.title')}
          </DialogTitle>
          <DialogDescription>
            {kind === 'replace' ? t('sideChat.replaceConfirm.body') : t('sideChat.closeConfirm.body')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row items-center gap-2">
          {kind === 'close' && (
            <label className="mr-auto flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox checked={dontAsk} onCheckedChange={(v) => setDontAsk(v === true)} />
              {t('sideChat.closeConfirm.dontAsk')}
            </label>
          )}
          <Button variant="outline" onClick={() => answer(false)}>{t('common.cancel')}</Button>
          <Button variant="destructive" onClick={() => answer(true)}>
            {kind === 'replace' ? t('sideChat.replaceConfirm.action') : t('sideChat.closeConfirm.action')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
