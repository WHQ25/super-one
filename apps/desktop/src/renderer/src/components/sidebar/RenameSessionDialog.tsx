import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'

export interface RenameSessionTarget {
  sessionId: string
  title: string
  folderPath: string
}

interface RenameSessionDialogProps {
  target: RenameSessionTarget | null
  onClose: () => void
  onRenamed: (target: RenameSessionTarget) => void
}

export function RenameSessionDialog({ target, onClose, onRenamed }: RenameSessionDialogProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')

  useEffect(() => {
    if (target) setValue(target.title)
  }, [target])

  const submit = async () => {
    if (!target || !value.trim()) return
    const title = value.trim()
    const { parseRemoteProjectKey } = await import('@/lib/remote-project-key')
    const remote = parseRemoteProjectKey(target.folderPath)
    if (remote) {
      await window.environment.renameSession(remote.connectionId, target.sessionId, title)
    } else {
      await window.app.renameSession(target.sessionId, title)
    }
    onRenamed(target)
    onClose()
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('sidebar.renameSession.title')}</DialogTitle>
        </DialogHeader>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
          autoFocus
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => void submit()} disabled={!value.trim()}>{t('common.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
