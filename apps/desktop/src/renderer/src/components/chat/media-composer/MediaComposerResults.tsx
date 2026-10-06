import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Copy, Download } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import type { MediaComposerResult } from '@superone/shared/media-composer'
import type { SessionWriteTarget } from '@/stores/chat'
import { toMediaUrl } from '@/lib/path-utils'
import { insertMediaIntoDraft, sendMediaToAgent } from './media-composer-output'

export function MediaComposerResults({ target, result, disabled, onUse, onReturn }: {
  target: SessionWriteTarget; result: MediaComposerResult; disabled: boolean
  onUse: () => void; onReturn: () => void
}) {
  const { t } = useTranslation()
  const [working, setWorking] = useState(false)
  const act = async (action: () => Promise<void>) => {
    if (working || disabled) return
    setWorking(true)
    try { await action() } catch (error) {
      toast.error(error instanceof Error && error.message === 'remoteVideoUnavailable' ? t('mediaComposer.remoteVideoUnavailable') : String(error))
    } finally { setWorking(false) }
  }
  const off = disabled || working
  return <div className="flex flex-col gap-1.5 pb-2 pt-1" data-media-results={result.generationId}>
    <div className="flex gap-2 overflow-x-auto">
      {result.files.map(file => <div key={file.path} className="group/result relative h-30 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/30">
        {result.kind === 'image' ? <img src={file.base64 ? `data:${file.mediaType};base64,${file.base64}` : toMediaUrl(file.path)} alt={file.path.split(/[\\/]/).at(-1)} className="h-full w-auto object-contain" />
          : <video src={/^(https?:|data:|blob:)/.test(file.path) ? file.path : toMediaUrl(file.path)} controls preload="metadata" className="h-full w-auto" />}
        <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/result:opacity-100">
          <IconButton size="sm" tooltip={t('mediaComposer.copy')} disabled={off} className="bg-background/90 text-foreground hover:bg-background" onClick={() => void act(async () => {
            if (result.kind === 'image') {
              const copied = await window.app.clipboardWriteImage(file.path)
              if (!copied.ok) throw new Error(copied.error)
            } else await window.app.clipboardWrite(file.path)
            toast.success(t('mediaComposer.copied'))
          })}><Copy /></IconButton>
          <IconButton size="sm" tooltip={t('mediaComposer.save')} disabled={off} className="bg-background/90 text-foreground hover:bg-background" onClick={() => void act(async () => {
            const saved = await window.app.saveFileAs(file.path, file.path.split(/[\\/]/).at(-1) ?? `result.${result.kind === 'image' ? 'png' : 'mp4'}`)
            if (!saved.ok && !saved.canceled) throw new Error(saved.error)
          })}><Download /></IconButton>
        </div>
      </div>)}
    </div>
    <div className="-ml-2 flex flex-wrap gap-0.5">
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" disabled={off} onClick={() => void act(async () => {
        await insertMediaIntoDraft(target, result); toast.success(t('mediaComposer.inserted')); onReturn()
      })}>{t('mediaComposer.insert')}</Button>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" disabled={off} onClick={() => void act(async () => { await sendMediaToAgent(target, result); onUse(); onReturn() })}>{t('mediaComposer.send')}</Button>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" disabled={off} onClick={onUse}>{t('mediaComposer.done')}</Button>
    </div>
  </div>
}
