import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Search, Globe, Bookmark, Clock, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Popover, PopoverAnchor, PopoverContent } from '@superone/ui/components/ui/popover'
import { useOmniboxSuggestions, type OmniboxKind } from './browser-suggest'
import { BrowserFavicon } from './BrowserFavicon'

interface BrowserOmniboxProps {
  url: string
  isHome: boolean
  onNavigate: (input: string) => void
}

const KIND_ICON: Record<OmniboxKind, typeof Search> = {
  url: Globe,
  search: Search,
  bookmark: Bookmark,
  history: Clock,
}

export function BrowserOmnibox({ url, isHome, onNavigate }: BrowserOmniboxProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(url)
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  const suggestions = useOmniboxSuggestions(draft, open)
  const showDropdown = open && suggestions.length > 0

  useEffect(() => {
    if (!editing) setDraft(isHome ? '' : url)
  }, [url, editing, isHome])

  useEffect(() => {
    if (active >= suggestions.length) setActive(suggestions.length - 1)
  }, [suggestions.length, active])

  const commit = (value: string) => {
    setOpen(false)
    setActive(-1)
    inputRef.current?.blur()
    onNavigate(value)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' && showDropdown) {
      e.preventDefault()
      setActive((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp' && showDropdown) {
      e.preventDefault()
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commit(active >= 0 && suggestions[active] ? suggestions[active].url : draft)
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  return (
    <Popover open={showDropdown} onOpenChange={(o) => { if (!o) setOpen(false) }}>
      <div className="group relative mx-1 min-w-0 flex-1">
        <PopoverAnchor asChild>
          <form onSubmit={(e) => { e.preventDefault(); commit(draft) }}>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setOpen(e.target.value.trim().length > 0); setActive(-1) }}
              onFocus={(e) => { setEditing(true); e.target.select() }}
              onBlur={() => { setEditing(false); setOpen(false); setActive(-1) }}
              onKeyDown={onKeyDown}
              spellCheck={false}
              placeholder={t('chat.browser.addressPlaceholder')}
              className={cn(
                'h-6 w-full rounded-md px-1.5 text-xs text-foreground outline-none transition-colors',
                showDropdown
                  ? 'rounded-b-none border border-b-0 border-border bg-popover/70 backdrop-blur-md backdrop-saturate-150 dark:bg-popover/85'
                  : 'bg-transparent hover:bg-muted focus:bg-muted focus:ring-1 focus:ring-border/60',
                !isHome && url && 'group-hover:pr-7',
                editing ? 'text-left' : 'text-center',
              )}
            />
          </form>
        </PopoverAnchor>
        {!isHome && url && (
          <IconButton
            type="button"
            size="xs"
            variant="ghost"
            tooltip="Open in external browser"
            onClick={() => window.app.openExternalLink(url)}
            className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            <ExternalLink className="size-3.5" />
          </IconButton>
        )}
      </div>
      <PopoverContent
        align="start"
        sideOffset={0}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        className="w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-t-none border-t-0 p-0 shadow-lg !animate-none"
      >
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="max-h-80 overflow-y-auto p-1"
        >
          {suggestions.map((s, i) => {
            const Icon = KIND_ICON[s.kind]
            return (
              <button
                key={s.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(s.url)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none',
                  i === active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                )}
              >
                <BrowserFavicon
                  src={s.favicon}
                  url={s.kind === 'search' ? null : s.url}
                  className="size-3.5 shrink-0"
                  fallback={<Icon className="size-3.5 shrink-0 text-muted-foreground" />}
                />
                <span className="min-w-0 flex-1 truncate">
                  {s.kind === 'search' ? t('chat.browser.searchFor', { query: s.primary }) : s.primary}
                </span>
                {s.secondary && <span className="max-w-[45%] shrink-0 truncate text-muted-foreground">{s.secondary}</span>}
              </button>
            )
          })}
        </motion.div>
      </PopoverContent>
    </Popover>
  )
}
