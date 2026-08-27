import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Search, Globe, Bookmark, Clock, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { useBrowserStore } from '@/stores/browser'
import { returnFocusToActivityPanel } from '@/components/activity/activity-focus'
import { claimNewTabOmniboxFocus } from '@/components/activity/activity-panel-api'
import { useOmniboxSuggestions, type OmniboxKind } from './browser-suggest'
import { hostOf, isSecureScheme } from './browser-url'
import { BrowserFavicon } from './BrowserFavicon'

interface BrowserOmniboxProps {
  browserId: string
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

function certReasonKey(error: string): string {
  const e = error.toUpperCase()
  if (e.includes('DATE') || e.includes('EXPIRED')) return 'chat.browser.insecureReasonExpired'
  if (e.includes('COMMON_NAME') || e.includes('NAME_MISMATCH')) return 'chat.browser.insecureReasonName'
  if (e.includes('AUTHORITY') || e.includes('SELF_SIGNED') || e.includes('ISSUER')) return 'chat.browser.insecureReasonAuthority'
  return 'chat.browser.insecureReasonGeneric'
}

export function BrowserOmnibox({ browserId, url, isHome, onNavigate }: BrowserOmniboxProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(url)
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  const suggestions = useOmniboxSuggestions(draft, open)
  const showDropdown = open && suggestions.length > 0
  const insecureReason = useBrowserStore((s) => {
    if (isHome || !isSecureScheme(url)) return null
    const host = hostOf(url)
    return host != null ? (s.insecureHosts[host] ?? null) : null
  })
  const insecure = insecureReason != null

  // A tab the user just opened blank lands the caret here, Chrome-style, so a URL
  // can be typed without reaching for the mouse. The queue is set when the panel is
  // added; this is the first moment an input exists to take it.
  useEffect(() => {
    if (claimNewTabOmniboxFocus(browserId)) inputRef.current?.focus()
  }, [browserId])

  useEffect(() => {
    if (!editing) setDraft(isHome ? '' : url)
  }, [url, editing, isHome])

  useEffect(() => {
    if (active >= suggestions.length) setActive(suggestions.length - 1)
  }, [suggestions.length, active])

  // Blurring is what leaves editing mode, so the field shows the resolved URL
  // instead of the draft — but a bare blur drops focus to <body> and takes the
  // panel out of the running for its own shortcuts. Hand it back instead.
  const releaseFocus = () => {
    const input = inputRef.current
    input?.blur()
    returnFocusToActivityPanel(input)
  }

  const commit = (value: string) => {
    setOpen(false)
    setActive(-1)
    releaseFocus()
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
      releaseFocus()
    }
  }

  return (
    <Popover open={showDropdown} onOpenChange={(o) => { if (!o) setOpen(false) }}>
      <div className="relative mx-1 min-w-0 flex-1">
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
                  : 'bg-transparent hover:bg-muted',
                insecure && 'px-6',
                editing ? 'text-left' : 'text-center',
              )}
            />
          </form>
        </PopoverAnchor>
        {insecureReason != null && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t('chat.browser.insecureTitle')}
                className="pointer-events-auto absolute left-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:ring-[3px] focus-visible:ring-destructive/40"
              >
                <TriangleAlert className="size-3.5 shrink-0" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="bottom" sideOffset={8} className="w-72 p-3">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 text-destructive">
                  <TriangleAlert className="size-4 shrink-0" />
                  <span className="text-sm font-medium">{t('chat.browser.insecureTitle')}</span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{t(certReasonKey(insecureReason))}</p>
                <code className="font-mono text-[11px] text-muted-foreground">{insecureReason}</code>
              </div>
            </PopoverContent>
          </Popover>
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
