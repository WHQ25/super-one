import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@superone/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@superone/ui/components/ui/dialog'
import type { CodexExternalAgentItem } from '@superone/shared/agent-types'

export function CodexImportConfigSection({ projectPath }: { projectPath: string | null }) {
  const { t } = useTranslation()
  const [items, setItems] = useState<CodexExternalAgentItem[] | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [importing, setImporting] = useState(false)

  const handleDetect = useCallback(async () => {
    if (!projectPath) return
    setDetecting(true)
    try {
      const found = await window.app.codexDetectExternalAgentConfig(projectPath)
      if (found.length === 0) {
        toast.info(t('settings.preferences.import.none'))
        return
      }
      setItems(found)
    } finally {
      setDetecting(false)
    }
  }, [projectPath, t])

  const handleImport = useCallback(async () => {
    if (!projectPath || !items) return
    setImporting(true)
    try {
      const res = await window.app.codexImportExternalAgentConfig(projectPath, items)
      if (res) toast.success(t('settings.preferences.import.done', { success: res.successCount, failure: res.failureCount }))
      else toast.error(t('settings.preferences.import.error'))
      setItems(null)
    } finally {
      setImporting(false)
    }
  }, [projectPath, items, t])

  return (
    <div className="rounded-lg border border-border">
      <div className="border-b border-border px-4 py-2">
        <p className="text-xs font-medium text-muted-foreground">{t('settings.preferences.import.section')}</p>
      </div>
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t('settings.preferences.import.label')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.preferences.import.description')}</p>
        </div>
        <Button size="sm" variant="outline" disabled={!projectPath || detecting} onClick={handleDetect}>
          {detecting ? t('settings.preferences.import.detecting') : t('settings.preferences.import.detect')}
        </Button>
      </div>

      <Dialog open={items !== null} onOpenChange={(open) => { if (!open) setItems(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('settings.preferences.import.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('settings.preferences.import.dialogDescription', { count: items?.length ?? 0 })}</DialogDescription>
          </DialogHeader>
          <ul className="max-h-60 space-y-1.5 overflow-y-auto text-sm">
            {items?.map((item, i) => (
              <li key={`${item.itemType}-${i}`} className="flex items-center gap-2">
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{item.itemType}</span>
                <span className="truncate">{item.description}</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setItems(null)} disabled={importing}>{t('common.cancel')}</Button>
            <Button onClick={handleImport} disabled={importing}>
              {importing ? t('settings.preferences.import.importing') : t('settings.preferences.import.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
