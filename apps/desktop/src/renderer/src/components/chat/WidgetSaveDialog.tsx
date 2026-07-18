import { useState } from 'react'
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
import { Input } from '@superone/ui/components/ui/input'
import { Textarea } from '@superone/ui/components/ui/textarea'
import type { WidgetData } from '@superone/shared/generative-ui/types'
import { useAppStore } from '@/stores/app'

interface WidgetSaveDialogProps {
  data: WidgetData
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WidgetSaveDialog({ data, open, onOpenChange }: WidgetSaveDialogProps) {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const isUpdate = !!data.templateId

  const [title, setTitle] = useState(data.title.replace(/_/g, ' '))
  const [description, setDescription] = useState(data.reusable?.description ?? '')
  const [scope, setScope] = useState<'project' | 'user'>(currentFolder ? 'project' : 'user')
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const saved = await window.app.saveWidgetTemplate(currentFolder, {
        id: data.templateId ?? data.reusable?.id ?? title,
        title,
        code: data.widget_code,
        description: description || undefined,
        inputSchema: data.reusable?.inputSchema,
        scope,
      })
      toast.success(t('widget.save.saved', { id: saved.id }))
      onOpenChange(false)
    } catch (err) {
      toast.error(t('widget.save.failed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isUpdate ? t('widget.save.updateTitle') : t('widget.save.title')}</DialogTitle>
          <DialogDescription>{t('widget.save.description')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('widget.save.namePlaceholder')} />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('widget.save.descriptionPlaceholder')}
            rows={2}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant={scope === 'project' ? 'default' : 'outline'}
              size="sm"
              disabled={!currentFolder}
              onClick={() => setScope('project')}
              className="flex-1"
            >
              {t('widget.save.scopeProject')}
            </Button>
            <Button
              type="button"
              variant={scope === 'user' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setScope('user')}
              className="flex-1"
            >
              {t('widget.save.scopeUser')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {scope === 'project' ? t('widget.save.scopeProjectHint') : t('widget.save.scopeUserHint')}
          </p>
          {!data.reusable?.inputSchema && !isUpdate && (
            <p className="text-xs text-muted-foreground">{t('widget.save.staticHint')}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !title.trim()}>
            {t('widget.save.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
