import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, Star, Code } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Button } from '@superone/ui/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@superone/ui/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@superone/ui/components/ui/dropdown-menu'
import { useBrowserStore } from '@/stores/browser'
import { useBrowserBookmarksStore } from '@/stores/browser-bookmarks'
import { browserOpenDevTools } from './browser-host-api'

export function BrowserMoreMenu({ browserId, isHome }: { browserId: string; isHome: boolean }) {
  const { t } = useTranslation()
  const tab = useBrowserStore((s) => s.tabs[browserId])
  const bookmarks = useBrowserBookmarksStore((s) => s.bookmarks)
  const groups = useBrowserBookmarksStore((s) => s.groups)
  const loaded = useBrowserBookmarksStore((s) => s.loaded)
  const { addBookmark, updateBookmark, removeByUrl } = useBrowserBookmarksStore.getState()
  const [editOpen, setEditOpen] = useState(false)
  const editIdRef = useRef<string | null>(null)

  useEffect(() => { if (!loaded) void useBrowserBookmarksStore.getState().load() }, [loaded])

  const url = tab?.url ?? ''
  const existing = bookmarks.find((b) => b.url === url)
  const isBookmarked = !!existing
  const current = bookmarks.find((b) => b.id === editIdRef.current)

  const openBookmarkEditor = () => {
    if (isHome || !url) return
    editIdRef.current = existing
      ? existing.id
      : addBookmark({ url, title: tab?.title || url, favicon: tab?.favicon ?? null }).id
    setTimeout(() => setEditOpen(true), 0)
  }

  return (
    <Popover open={editOpen} onOpenChange={setEditOpen}>
      <DropdownMenu>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <IconButton size="xs" variant="ghost" tooltip="More">
              <MoreHorizontal className="size-3.5" />
            </IconButton>
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={isHome} onSelect={openBookmarkEditor}>
            <Star className={cn('size-3.5', isBookmarked && 'fill-primary text-primary')} />
            {isBookmarked ? t('chat.browser.bookmarkEdit') : t('chat.browser.bookmark')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => browserOpenDevTools(browserId)}>
            <Code className="size-3.5" />
            Open DevTools
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {current && (
        <PopoverContent align="end" className="w-72 p-3">
          <p className="mb-2 text-xs font-medium">{t('chat.browser.bookmarkAdded')}</p>
          <input
            autoFocus
            value={current.title}
            onChange={(e) => updateBookmark(current.id, { title: e.target.value })}
            placeholder={t('chat.browser.bookmarkName')}
            className="mb-2 h-7 w-full rounded-md border border-border bg-transparent px-2 text-xs outline-none focus:ring-1 focus:ring-ring/50"
          />
          <select
            value={current.groupId ?? ''}
            onChange={(e) => updateBookmark(current.id, { groupId: e.target.value || null })}
            className="mb-3 h-7 w-full rounded-md border border-border bg-transparent px-1.5 text-xs outline-none focus:ring-1 focus:ring-ring/50"
          >
            <option value="">{t('chat.browser.bookmarkNoFolder')}</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <div className="flex justify-between">
            <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => { removeByUrl(current.url); setEditOpen(false) }}>
              {t('chat.browser.bookmarkRemove')}
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={() => setEditOpen(false)}>
              {t('chat.browser.bookmarkDone')}
            </Button>
          </div>
        </PopoverContent>
      )}
    </Popover>
  )
}
