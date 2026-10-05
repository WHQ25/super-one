import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@superone/ui/components/ui/button'
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
  return <div className="flex flex-col gap-2" data-media-results={result.generationId}>
    <div className="grid grid-cols-2 gap-2">
      {result.files.map(file => <div key={file.path} className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border p-2">
        {result.kind === 'image' ? <img src={file.base64 ? `data:${file.mediaType};base64,${file.base64}` : toMediaUrl(file.path)} alt={file.path.split(/[\\/]/).at(-1)} className="max-h-40 w-full rounded object-contain" />
          : <video src={/^(https?:|data:|blob:)/.test(file.path) ? file.path : toMediaUrl(file.path)} controls preload="metadata" className="max-h-40 w-full rounded" />}
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" disabled={disabled || working} onClick={() => void act(async () => {
            if (result.kind === 'image') {
              const copied = await window.app.clipboardWriteImage(file.path)
              if (!copied.ok) throw new Error(copied.error)
            } else await window.app.clipboardWrite(file.path)
            toast.success(t('mediaComposer.copied'))
          })}>{t('mediaComposer.copy')}</Button>
          <Button size="sm" variant="ghost" disabled={disabled || working} onClick={() => void act(async () => {
            const saved = await window.app.saveFileAs(file.path, file.path.split(/[\\/]/).at(-1) ?? `result.${result.kind === 'image' ? 'png' : 'mp4'}`)
            if (!saved.ok && !saved.canceled) throw new Error(saved.error)
          })}>{t('mediaComposer.save')}</Button>
        </div>
      </div>)}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={disabled || working} onClick={() => void act(async () => {
        await insertMediaIntoDraft(target, result); toast.success(t('mediaComposer.inserted')); onReturn()
      })}>{t('mediaComposer.insert')}</Button>
      <Button size="sm" variant="outline" disabled={disabled || working} onClick={() => void act(async () => { await sendMediaToAgent(target, result); onUse(); onReturn() })}>{t('mediaComposer.send')}</Button>
      <Button size="sm" variant="ghost" disabled={disabled || working} onClick={onUse}>{t('mediaComposer.done')}</Button>
    </div>
  </div>
}
