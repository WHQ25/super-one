import { useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import type { MediaComposerKind, MediaComposerReference } from '@superone/shared/media-composer'
import { MediaOptionSelector } from './MediaOptionSelector'

const REFERENCE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_REFERENCES = 8
type ReferenceRole = NonNullable<MediaComposerReference['role']>

/** Reads dropped or picked files; rejects the whole batch when it breaks the request limits. */
export async function readReferenceFiles(files: File[], existing: MediaComposerReference[]): Promise<MediaComposerReference[]> {
  if (existing.length + files.length > MAX_REFERENCES || files.some(file => !REFERENCE_TYPES.includes(file.type)) ||
    files.reduce((total, file) => total + file.size, 0) + existing.reduce((total, ref) => total + ref.base64.length * 0.75, 0) > 24 * 1024 * 1024) throw new Error()
  const added = await Promise.all(files.map(file => new Promise<MediaComposerReference>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ name: file.name, mediaType: file.type, base64: String(reader.result).split(',')[1]!, role: 'reference' })
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })))
  const references = [...existing, ...added]
  if (references.reduce((total, ref) => total + ref.base64.length, 0) > 32 * 1024 * 1024) throw new Error()
  return references
}

export function useReferenceFiles(references: MediaComposerReference[], onChange: (references: MediaComposerReference[]) => void) {
  const { t } = useTranslation()
  return (files: File[]) => {
    if (!files.length) return
    void readReferenceFiles(files, references).then(onChange, () => toast.error(t('mediaComposer.badReference')))
  }
}

/** A thumbnail with a hover remove control and an optional caption underneath. */
function ReferenceThumb({ src, name, onRemove, caption }: { src: string; name: string; onRemove?: () => void; caption?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="group/reference relative size-12 shrink-0">
        <img src={src} alt={name} title={name} className="size-full rounded-lg border border-border object-cover" />
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={t('mediaComposer.remove', { name })}
            className="absolute -right-1.5 -top-1.5 hidden size-4.5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground focus-visible:flex group-hover/reference:flex"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      {caption}
    </div>
  )
}

/** Editable reference images: a drop target when empty, thumbnails plus an add tile otherwise. */
export function MediaReferences({ kind, references, roles, onChange, onAdd }: {
  kind: MediaComposerKind
  references: MediaComposerReference[]
  /** Video roles the selected model reads, in menu order; images always take plain references. */
  roles?: ReferenceRole[]
  onChange: (references: MediaComposerReference[]) => void
  onAdd: (files: File[]) => void
}) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const setRole = (index: number, role: ReferenceRole) => onChange(references.map((ref, i) => i === index
    ? { ...ref, role }
    // A start or end frame is unique; the previous holder becomes a reference.
    : role !== 'reference' && ref.role === role ? { ...ref, role: 'reference' } : ref))
  const picker = <input ref={input} type="file" accept={REFERENCE_TYPES.join(',')} multiple className="sr-only" tabIndex={-1} aria-hidden="true"
    onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; onAdd(files) }} />
  if (!references.length) {
    return (
      <div className="pb-2 pt-0.5">
        {picker}
        <button type="button" onClick={() => input.current?.click()} className="flex h-12 w-full items-center gap-2.5 rounded-lg border border-dashed border-border px-3 text-left text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-foreground">
          <Upload className="size-4 shrink-0" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-xs">{t('mediaComposer.dropReferences')}</span>
            <span className="truncate text-[11px] text-muted-foreground">{t(kind === 'image' ? 'mediaComposer.imageReferenceHint' : 'mediaComposer.videoReferenceHint')}</span>
          </span>
        </button>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-start gap-2.5 pb-2 pt-1.5">
      {picker}
      {references.map((ref, index) => (
        <ReferenceThumb
          key={index}
          src={`data:${ref.mediaType};base64,${ref.base64}`}
          name={ref.name}
          onRemove={() => onChange(references.filter((_, i) => i !== index))}
          caption={kind === 'video' && roles && roles.length > 1 && (
            <MediaOptionSelector
              title={ref.name}
              label={t(`mediaComposer.${ref.role ?? 'reference'}`)}
              className="px-1 py-0 text-[11px]"
              value={ref.role ?? 'reference'}
              onChange={role => setRole(index, role as ReferenceRole)}
              groups={[{ label: t('mediaComposer.referenceRole'), options: roles.map(role => ({ value: role, label: t(`mediaComposer.${role}`) })) }]}
            />
          )}
        />
      ))}
      {references.length < MAX_REFERENCES && (
        <button type="button" onClick={() => input.current?.click()} aria-label={t('mediaComposer.addReference')} title={t('mediaComposer.addReference')}
          className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground">
          <Plus className="size-4" />
        </button>
      )}
    </div>
  )
}

/** Read-only references, e.g. the files an agent attached to a generation request. */
export function MediaReferenceStrip({ items }: { items: { key: string; src: string; name: string; label: string }[] }) {
  if (!items.length) return null
  return (
    <div className="flex flex-wrap items-start gap-2.5 pb-2 pt-1.5">
      {items.map(item => <ReferenceThumb key={item.key} src={item.src} name={item.name} caption={<span className="text-[11px] text-muted-foreground">{item.label}</span>} />)}
    </div>
  )
}
