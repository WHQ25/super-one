import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, Loader2, Plus, X } from 'lucide-react'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { formatBytes } from '@superone/shared/format-bytes'
import { safeMcpAppImage } from '@superone/shared/mcp-apps-metadata'
import type { McpAppReadResult } from '@superone/shared/mcp-apps'
import type { McpFormResourceActions } from '@superone/shared/mcp-form-resources'
import type { SchemaFormField, SchemaFormValue } from '@superone/shared/schema-form'
import { SchemaFormThumbnail } from './SchemaFormThumbnail'
import { SchemaFormChoiceRow, type ChoiceNumbers } from './SchemaFormChoiceRow'

type ResourceField = Extract<SchemaFormField, { kind: 'resource' }>

/** Expanded server data is inert text or an image, never a document/script in the host origin. */
function ResourcePreview({ result }: { result: McpAppReadResult }) {
  const { t } = useTranslation()
  return <div className="flex max-h-64 flex-col gap-2 overflow-auto rounded-md border border-border bg-muted/30 p-2" data-testid="resource-preview">
    {result.contents.length === 0 && <p className="text-xs text-muted-foreground">{t('chat.schemaForm.previewEmpty')}</p>}
    {result.contents.map((content, index) => {
      const image = typeof content.blob === 'string' && content.mimeType
        ? safeMcpAppImage(`data:${content.mimeType};base64,${content.blob}`) : undefined
      return <div key={index} className="min-w-0">
        {typeof content.text === 'string' ? <pre className="text-xs whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{content.text}</pre>
          : image ? <img src={image} alt="" referrerPolicy="no-referrer" className="max-h-56 max-w-full object-contain" />
            : <p className="text-xs text-muted-foreground">{t('chat.schemaForm.previewBinary', { type: content.mimeType ?? 'application/octet-stream' })}</p>}
      </div>
    })}
  </div>
}

export function SchemaFormResourceField({ field, value, invalid, describedBy, onChange, resources, numbers }: {
  field: ResourceField
  value: SchemaFormValue | undefined
  invalid: boolean
  describedBy?: string
  onChange: (value: SchemaFormValue | undefined) => void
  resources?: McpFormResourceActions
  /** Shortcut numbers for picked resources; an implicit selection has none. */
  numbers?: ChoiceNumbers
}) {
  const { t } = useTranslation()
  const multiple = field.selection !== 'single'
  const implicit = field.selection === 'implicit'
  const selected = multiple ? (Array.isArray(value) ? value : []) : typeof value === 'string' ? [value] : []
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string>()
  const [preview, setPreview] = useState<{ uri: string; loading?: boolean; result?: McpAppReadResult; error?: string }>()
  const alive = useRef(true)
  const previewVersion = useRef(0)
  useEffect(() => { alive.current = true; return () => { alive.current = false; previewVersion.current++ } }, [])
  const pick = async () => {
    if (!resources || picking) return
    setPicking(true); setError(undefined)
    try {
      const added = await resources.pick(field.name)
      if (!alive.current || !added.length) return
      onChange(multiple ? [...new Set([...selected, ...added.map(option => option.uri)])] : added[0].uri)
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : t('chat.schemaForm.resourceError')) }
    finally { if (alive.current) setPicking(false) }
  }
  const showPreview = async (uri: string) => {
    const version = ++previewVersion.current
    if (preview?.uri === uri) { setPreview(undefined); return }
    if (!resources) return
    setPreview({ uri, loading: true })
    try {
      const result = await resources.preview(field.name, uri)
      if (alive.current && version === previewVersion.current) setPreview({ uri, result })
    } catch (cause) {
      if (alive.current && version === previewVersion.current) setPreview({ uri, error: cause instanceof Error ? cause.message : t('chat.schemaForm.resourceError') })
    }
  }
  const visible = implicit ? field.options.filter(option => selected.includes(option.uri)) : field.options
  const removed = implicit ? field.options.filter(option => !selected.includes(option.uri)) : []
  return <div role={multiple ? 'group' : 'radiogroup'} aria-label={field.label} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="flex flex-col gap-0.5">
    {visible.length === 0 && <p className="rounded-md border border-dashed border-border px-2 py-2 text-xs text-muted-foreground">{t('chat.schemaForm.noResources')}</p>}
    {visible.map((resource, index) => {
      const label = resource.title ?? resource.name
      const checked = selected.includes(resource.uri)
      const details = [resource.title ? resource.name : undefined, resource.size !== undefined ? formatBytes(resource.size) : undefined].filter(Boolean).join(' · ')
      return <div key={resource.uri} className="flex flex-col gap-1">
        <SchemaFormChoiceRow index={index} numbers={implicit ? undefined : numbers} multiple={multiple} checked={implicit ? undefined : checked}
          onSelect={() => onChange(multiple ? checked ? selected.filter(uri => uri !== resource.uri) : [...selected, resource.uri] : resource.uri)}
          media={resource.thumbnail ? <SchemaFormThumbnail image={resource.thumbnail} className="size-8 shrink-0 rounded" />
            : <span className="flex size-8 shrink-0 items-center justify-center rounded bg-muted"><FileIcon name={resource.name} size={16} /></span>}
          trailing={<>
            {resources && resource.preview?.type === 'resource_link' && <button type="button" aria-label={t('chat.schemaForm.preview', { name: label })} aria-expanded={preview?.uri === resource.uri} onClick={() => void showPreview(resource.uri)} className="mr-1 cursor-pointer rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><Eye className="size-3.5" /></button>}
            {implicit && <button type="button" aria-label={t('chat.schemaForm.remove', { name: label })} onClick={() => onChange(selected.filter(uri => uri !== resource.uri))} className="mr-1 cursor-pointer rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="size-3.5" /></button>}
          </>}>
          <span className="block truncate text-xs text-foreground">{label}</span>
          {(resource.description || details) && <span className="block truncate text-xs text-muted-foreground">{resource.description ?? details}</span>}
        </SchemaFormChoiceRow>
        {preview?.uri === resource.uri && (preview.loading ? <p role="status" className="flex items-center gap-1 p-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" />{t('chat.schemaForm.previewLoading')}</p>
          : preview.error ? <p role="alert" className="p-2 text-xs text-destructive">{preview.error}</p>
            : preview.result ? <ResourcePreview result={preview.result} /> : null)}
      </div>
    })}
    {removed.length > 0 && <div className="flex flex-wrap gap-1">
      {removed.map(resource => <button key={resource.uri} type="button" onClick={() => onChange([...selected, resource.uri])}
        className="flex max-w-full cursor-pointer items-center gap-1 rounded border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent">
        <Plus className="size-3 shrink-0" /><span className="truncate">{t('chat.schemaForm.add')} {resource.title ?? resource.name}</span>
      </button>)}
    </div>}
    {resources && field.userOptions && <button type="button" disabled={picking} onClick={() => void pick()} className="mt-1 flex cursor-pointer items-center justify-center gap-1 rounded-md border border-dashed border-border p-2 text-xs hover:bg-accent disabled:cursor-wait disabled:opacity-50">
      {picking ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
      {t(field.userOptions.kind === 'directory' ? 'chat.schemaForm.addDirectory' : 'chat.schemaForm.addFiles')}
    </button>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>
}
