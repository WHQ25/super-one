import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { Label } from '@superone/ui/components/ui/label'
import { Input } from '@superone/ui/components/ui/input'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@superone/ui/components/ui/select'
import type { MediaComposerKind, MediaComposerModel, MediaComposerReference } from '@superone/shared/media-composer'
import { toast } from 'sonner'

export interface MediaComposerForm {
  prompt: string
  providerId?: string
  model?: string
  references: MediaComposerReference[]
  size?: string
  aspectRatio?: string
  duration?: number
  resolution?: string
  output: 'caller' | 'agent'
  paused?: boolean
}

export function MediaComposerFields({ kind, form, models, selected, disabled, change }: {
  kind: MediaComposerKind; form: MediaComposerForm; models: MediaComposerModel[]
  selected?: MediaComposerModel; disabled: boolean; change: (patch: Partial<MediaComposerForm>) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const field = (name: string) => `${id}-${name}`
  const ratios = ['', '1:1', '16:9', '9:16', '4:3', '3:4']
  const pickReferences = async (files: File[]) => {
    try {
      if (form.references.length + files.length > 8 || files.some(file => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) ||
        files.reduce((total, file) => total + file.size, 0) + form.references.reduce((total, ref) => total + ref.base64.length * 0.75, 0) > 24 * 1024 * 1024) throw new Error()
      const refs = await Promise.all(files.map(file => new Promise<MediaComposerReference>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve({ name: file.name, mediaType: file.type, base64: String(reader.result).split(',')[1]!, role: 'reference' })
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })))
      const references = [...form.references, ...refs]
      if (references.reduce((total, ref) => total + ref.base64.length, 0) > 32 * 1024 * 1024) throw new Error()
      change({ references })
    } catch { toast.error(t('mediaComposer.badReference')) }
  }
  return <>
    <div className="grid grid-cols-2 gap-2 @min-[480px]:grid-cols-3">
      <div className="col-span-2 flex min-w-0 flex-col gap-1 @min-[480px]:col-span-1">
        <Label htmlFor={field('model')} className="text-xs">{t('mediaComposer.model')}</Label>
        <Select disabled={disabled || !models.length} value={selected ? JSON.stringify([selected.providerId, selected.model]) : ''} onValueChange={key => {
          const [providerId, model] = JSON.parse(key); change({ providerId, model })
        }}>
          <SelectTrigger id={field('model')} className="h-8 w-full min-w-0 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{models.map(model => <SelectItem key={JSON.stringify([model.providerId, model.model])} value={JSON.stringify([model.providerId, model.model])}>
            {model.providerLabel} · {model.label}
          </SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={field('ratio')} className="text-xs">{t('mediaComposer.aspectRatio')}</Label>
        <Select disabled={disabled} value={form.aspectRatio || 'auto'} onValueChange={value => change({ aspectRatio: value === 'auto' ? '' : value })}>
          <SelectTrigger id={field('ratio')} className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{ratios.map(ratio => <SelectItem key={ratio || 'auto'} value={ratio || 'auto'}>{ratio || t('mediaComposer.automatic')}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={field('output')} className="text-xs">{t('mediaComposer.output')}</Label>
        <Select disabled={disabled} value={form.output} onValueChange={output => change({ output: output as 'caller' | 'agent' })}>
          <SelectTrigger id={field('output')} className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{(['caller', 'agent'] as const).map(output => <SelectItem key={output} value={output}>{t(`mediaComposer.${output}`)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {kind === 'image' ? <div className="flex flex-col gap-1">
        <Label htmlFor={field('size')} className="text-xs">{t('mediaComposer.size')}</Label>
        <Input id={field('size')} disabled={disabled} value={form.size ?? ''} placeholder={t('mediaComposer.automatic')} className="h-8 text-xs" onChange={event => change({ size: event.target.value })} />
      </div> : <>
        <div className="flex flex-col gap-1"><Label htmlFor={field('duration')} className="text-xs">{t('mediaComposer.duration')}</Label>
          <Input id={field('duration')} type="number" min={1} max={120} disabled={disabled} value={form.duration ?? ''} placeholder={t('mediaComposer.automatic')} className="h-8 text-xs" onChange={event => change({ duration: event.target.value ? Number(event.target.value) : undefined })} />
        </div>
        <div className="flex flex-col gap-1"><Label htmlFor={field('resolution')} className="text-xs">{t('mediaComposer.resolution')}</Label>
          <Select disabled={disabled} value={form.resolution || 'auto'} onValueChange={resolution => change({ resolution: resolution === 'auto' ? '' : resolution })}>
            <SelectTrigger id={field('resolution')} className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{['auto', '480p', '720p', '1080p'].map(resolution => <SelectItem key={resolution} value={resolution}>{resolution === 'auto' ? t('mediaComposer.automatic') : resolution}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </>}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" className="relative text-xs" asChild><label>
        <Plus className="size-3.5" />{t('mediaComposer.references')}
        <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={disabled} className="sr-only" aria-label={t('mediaComposer.references')} onChange={event => {
          const files = Array.from(event.target.files ?? []); event.target.value = ''; void pickReferences(files)
        }} />
      </label></Button>
      {form.references.map((ref, index) => <div key={index} className="flex items-center gap-1 rounded-md border border-border p-1">
        <img src={`data:${ref.mediaType};base64,${ref.base64}`} alt={ref.name} className="size-9 rounded object-cover" />
        {kind === 'video' && <Select disabled={disabled} value={ref.role ?? 'reference'} onValueChange={role => change({ references: form.references.map((item, i) => i === index ? { ...item, role: role as MediaComposerReference['role'] } : item) })}>
          <SelectTrigger aria-label={ref.name} className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{(['reference', 'first', 'last'] as const).map(role => <SelectItem key={role} value={role}>{t(`mediaComposer.${role}`)}</SelectItem>)}</SelectContent>
        </Select>}
        <IconButton size="xs" disabled={disabled} tooltip={t('mediaComposer.remove', { name: ref.name })} onClick={() => change({ references: form.references.filter((_, i) => i !== index) })}><X /></IconButton>
      </div>)}
    </div>
  </>
}
