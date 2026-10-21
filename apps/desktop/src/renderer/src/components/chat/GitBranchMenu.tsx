import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, GitBranch, Plus } from 'lucide-react'

export interface GitBranchMenuProps {
  current: string | null
  currentDetail?: ReactNode
  local: string[]
  tracking: string[]
  /** Catalog label, or "This PC" when the session has no bucket yet. */
  environmentLabel: string
  loading?: boolean
  fetching?: boolean
  fetchError?: string | null
  /** Replaces the empty-list sentence while a search is active. */
  emptyLabel?: string
  onSelect: (branch: string) => void
  onSelectTracking: (ref: string) => void
  onCreate: (name: string) => void
  onFetch: () => void
}

const rowClass = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent'

export function GitBranchMenu({
  current,
  currentDetail = null,
  local,
  tracking,
  environmentLabel,
  loading = false,
  fetching = false,
  fetchError = null,
  emptyLabel,
  onSelect,
  onSelectTracking,
  onCreate,
  onFetch,
}: GitBranchMenuProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const [naming, setNaming] = useState(false)
  const localRows = [
    ...(current ? [current] : []),
    ...local.filter((branch) => branch !== current),
  ]
  const empty = !loading && localRows.length === 0 && tracking.length === 0

  const submitDraft = (event: FormEvent) => {
    event.preventDefault()
    const name = draft.trim()
    if (!name) return
    onCreate(name)
    setDraft('')
  }

  return (
    <div>
      <div className="max-h-80 overflow-y-auto">
        {loading && (
          <div className="px-3 py-2 text-xs text-muted-foreground">{t('common.loading')}</div>
        )}
        {empty && (
          <div className="px-3 py-2 text-xs text-muted-foreground">{emptyLabel ?? t('chat.git.noBranches')}</div>
        )}
        {localRows.length > 0 && (
          <div className="px-3 pt-2 text-xs uppercase text-muted-foreground">
            {t('chat.git.localBranches', { environment: environmentLabel })}
          </div>
        )}
        {localRows.map((branch) => (
          <button key={branch} type="button" className={rowClass} onClick={() => onSelect(branch)}>
            <GitBranch className="size-3 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col text-left">
              <span className="truncate">{branch}</span>
              {branch === current && currentDetail}
            </span>
            {branch === current && <Check className="size-3 shrink-0 text-primary" />}
          </button>
        ))}
        <div className="flex items-center gap-2 px-3 pt-2">
          <span className="min-w-0 flex-1 text-xs uppercase text-muted-foreground">{t('chat.git.tracking')}</span>
          <button
            type="button"
            disabled={fetching}
            onClick={onFetch}
            className="shrink-0 rounded px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
          >
            {fetching ? t('chat.git.fetching') : t('chat.git.fetch')}
          </button>
        </div>
        {fetchError && (
          <div className="truncate px-3 py-1 text-xs text-destructive" title={fetchError}>
            {t('chat.git.fetchFailed', { error: fetchError })}
          </div>
        )}
        {tracking.map((ref) => (
          <button key={ref} type="button" className={rowClass} onClick={() => onSelectTracking(ref)}>
            <GitBranch className="size-3 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">{ref}</span>
          </button>
        ))}
      </div>
      <div className="border-t">
        {naming ? (
          <form className="flex items-center gap-2 px-3 py-1.5" onSubmit={submitDraft}>
            <Plus className="size-3 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t('chat.git.newBranch')}
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </form>
        ) : (
          <button type="button" className={rowClass} onClick={() => setNaming(true)}>
            <Plus className="size-3 shrink-0 text-muted-foreground" />
            <span>{t('chat.git.newBranch')}</span>
          </button>
        )}
      </div>
    </div>
  )
}
