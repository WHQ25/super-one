import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, GitBranch, Plus } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@superone/ui/components/ui/command'

export interface GitBranchMenuProps {
  current: string | null
  currentDetail?: ReactNode
  local: string[]
  tracking: string[]
  search: string
  onSearchChange: (value: string) => void
  loading?: boolean
  fetching?: boolean
  fetchError?: string | null
  onSelect: (branch: string) => void
  onSelectTracking: (ref: string) => void
  onCreate: (name: string) => void
  onFetch: () => void
}

export function GitBranchMenu({
  current,
  currentDetail = null,
  local,
  tracking,
  search,
  onSearchChange,
  loading = false,
  fetching = false,
  fetchError = null,
  onSelect,
  onSelectTracking,
  onCreate,
  onFetch,
}: GitBranchMenuProps) {
  const { t } = useTranslation()
  const needle = search.trim().toLowerCase()
  const currentMatch = !!current && current.toLowerCase().includes(needle)
  const otherLocal = local.filter((branch) => branch !== current && branch.toLowerCase().includes(needle))
  const trackingMatches = tracking.filter((ref) => ref.toLowerCase().includes(needle))
  const trimmed = search.trim()
  const canCreate = trimmed.length > 0
    && trimmed.toLowerCase() !== current?.toLowerCase()
    && !local.some((branch) => branch.toLowerCase() === trimmed.toLowerCase())
    && !tracking.some((ref) => ref.toLowerCase() === trimmed.toLowerCase())
  const empty = !loading && !currentMatch && otherLocal.length === 0 && trackingMatches.length === 0 && !canCreate

  return (
    <div>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <button
          type="button"
          disabled={fetching}
          onClick={onFetch}
          className="shrink-0 rounded px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
        >
          {fetching ? t('chat.git.fetching') : t('chat.git.fetch')}
        </button>
        {fetchError && (
          <span className="min-w-0 flex-1 truncate text-xs text-destructive" title={fetchError}>
            {t('chat.git.fetchFailed', { error: fetchError })}
          </span>
        )}
      </div>
      <Command shouldFilter={false}>
        <CommandInput
          placeholder={t('chat.git.searchBranches')}
          value={search}
          onValueChange={onSearchChange}
        />
        <CommandList>
          {loading && (
            <div className="px-3 py-2 text-xs text-muted-foreground">{t('common.loading')}</div>
          )}
          {empty && <CommandEmpty>{t('chat.git.noBranches')}</CommandEmpty>}
          {currentMatch && current && (
            <CommandGroup>
              <CommandItem value={current} onSelect={() => onSelect(current)} className="gap-2 text-xs">
                <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{current}</span>
                  {currentDetail}
                </div>
                <Check className="size-3 shrink-0 text-primary" />
              </CommandItem>
            </CommandGroup>
          )}
          {otherLocal.length > 0 && (
            <>
              {currentMatch && <CommandSeparator />}
              <CommandGroup>
                {otherLocal.map((branch) => (
                  <CommandItem
                    key={branch}
                    value={branch}
                    onSelect={() => onSelect(branch)}
                    className="gap-2 text-xs"
                  >
                    <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{branch}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
          {trackingMatches.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={t('chat.git.tracking')}>
                {trackingMatches.map((ref) => (
                  <CommandItem
                    key={ref}
                    value={ref}
                    onSelect={() => onSelectTracking(ref)}
                    className="gap-2 text-xs"
                  >
                    <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{ref}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
          {canCreate && (
            <>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  value={`__create__${trimmed}`}
                  onSelect={() => onCreate(trimmed)}
                  className="gap-2 text-xs"
                >
                  <Plus className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{t('chat.git.createBranch', { name: trimmed })}</span>
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </div>
  )
}
