import { useMemo, useState } from 'react'
import { Check, Plus, Search, X } from 'lucide-react'
import { useModelCatalog } from '@/hooks/useModelCatalog'
import type { CatalogModality, CatalogModel } from '@superone/shared/model-catalog-types'

function formatContext(tokens?: number): string {
  if (!tokens) return ''
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`
  return String(tokens)
}

function formatPrice(model: CatalogModel): string {
  if (!model.cost) return ''
  const { input, output } = model.cost
  return `$${input}/$${output}`
}

const MODALITY_LABEL: Record<CatalogModality, string> = {
  text: 'Text',
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
  pdf: 'PDF',
}

/** Multi-select model picker backed by the models.dev catalog, filtered to models that output `modality`. */
export function ModelCatalogPicker({
  modality,
  selected,
  onChange,
}: {
  modality: CatalogModality
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const { catalog, loading } = useModelCatalog()
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState('')

  const models = useMemo(() => {
    if (!catalog) return []
    const all = catalog.providers.flatMap((p) => p.models.filter((m) => m.outputModalities.includes(modality)))
    const q = query.trim().toLowerCase()
    const filtered = q
      ? all.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      : all
    return filtered.slice(0, 200)
  }, [catalog, modality, query])

  const selectedSet = new Set(selected)

  const toggle = (id: string) => {
    onChange(selectedSet.has(id) ? selected.filter((s) => s !== id) : [...selected, id])
  }

  const addManual = () => {
    const id = manual.trim()
    if (id && !selectedSet.has(id)) onChange([...selected, id])
    setManual('')
  }

  return (
    <div className="flex flex-col gap-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 font-mono text-[11px]">
              {id}
              <button type="button" onClick={() => toggle(id)} className="text-muted-foreground hover:text-destructive">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search models…"
        />
      </div>

      <div className="max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border">
        {loading && <div className="p-3 text-xs text-muted-foreground">Loading catalog…</div>}
        {!loading && models.length === 0 && (
          <div className="p-3 text-xs text-muted-foreground">No matching models.</div>
        )}
        {models.map((m) => {
          const active = selectedSet.has(m.id)
          return (
            <button
              key={`${m.providerId}/${m.id}`}
              type="button"
              onClick={() => toggle(m.id)}
              className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/60 ${active ? 'bg-primary/5' : ''}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  {active && <Check className="size-3 shrink-0 text-primary" />}
                  <span className="truncate text-xs font-medium">{m.name}</span>
                  <span className="truncate font-mono text-[10px] text-muted-foreground">{m.id}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                  <span>{m.providerId}</span>
                  {m.contextWindow ? <span>· {formatContext(m.contextWindow)} ctx</span> : null}
                  {formatPrice(m) ? <span>· {formatPrice(m)}/M</span> : null}
                  {m.inputModalities.length > 0 && (
                    <span>· in: {m.inputModalities.map((i) => MODALITY_LABEL[i]).join(', ')}</span>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-1.5">
        <input
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addManual() } }}
          placeholder="Add a model id not in the catalog…"
        />
        <button
          type="button"
          onClick={addManual}
          disabled={!manual.trim()}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <Plus className="size-3" /> Add
        </button>
      </div>
    </div>
  )
}
