import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, GitBranch, Plus } from 'lucide-react'

export interface GitBranchMenuProps {
  current: string | null
  currentDetail?: ReactNode
  local: string[]
  loading?: boolean
  /** Replaces the empty-list sentence while a search is active. */
  emptyLabel?: string
  onSelect: (branch: string) => void
  onCreate: (name: string) => void
}

const rowClass = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent'

export function GitBranchMenu({
  current,
  currentDetail = null,
  local,
  loading = false,
  emptyLabel,
  onSelect,
  onCreate,
}: GitBranchMenuProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const [naming, setNaming] = useState(false)
  const localRows = [
    ...(current ? [current] : []),
    ...local.filter((branch) => branch !== current),
  ]
  const empty = !loading && localRows.length === 0

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
