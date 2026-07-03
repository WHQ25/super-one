import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, Star, Code } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Button } from '@superone/ui/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger } from '@superone/ui/components/ui/dropdown-menu'
import { useBrowserStore } from '@/stores/browser'
import { useBrowserBookmarksStore } from '@/stores/browser-bookmarks'
import { browserOpenDevTools, browserIdByWebContentsId } from './browser-host-api'

const bookmarkShortcut = window.app.platform === 'darwin' ? '⌘D' : 'Ctrl+D'

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
    setEditOpen(true)
  }

  const openEditorRef = useRef(openBookmarkEditor)
  openEditorRef.current = openBookmarkEditor

  useEffect(() => {
    return window.app.onBrowserBookmarkShortcut((webContentsId) => {
      if (browserIdByWebContentsId(webContentsId) === browserId) openEditorRef.current()
    })
  }, [browserId])

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton size="xs" variant="ghost" tooltip="More">
            <MoreHorizontal className="size-3.5" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={isHome} onSelect={openBookmarkEditor}>
            <Star className={cn('size-3.5', isBookmarked && 'fill-primary text-primary')} />
            {isBookmarked ? t('chat.browser.bookmarkEdit') : t('chat.browser.bookmark')}
            <DropdownMenuShortcut>{bookmarkShortcut}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => browserOpenDevTools(browserId)}>
            <Code className="size-3.5" />
            Open DevTools
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        {current && (
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{isBookmarked ? t('chat.browser.bookmarkEdit') : t('chat.browser.bookmarkAdded')}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t('chat.browser.bookmarkName')}</span>
                <input
                  autoFocus
                  value={current.title}
                  onChange={(e) => updateBookmark(current.id, { title: e.target.value })}
                  className="h-8 w-full rounded-md border border-border bg-transparent px-2 text-sm outline-none focus:ring-1 focus:ring-ring/50"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t('chat.browser.bookmarkUrl')}</span>
                <input
                  value={current.url}
                  onChange={(e) => updateBookmark(current.id, { url: e.target.value })}
                  className="h-8 w-full rounded-md border border-border bg-transparent px-2 text-sm outline-none focus:ring-1 focus:ring-ring/50"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t('chat.browser.bookmarks')}</span>
                <select
                  value={current.groupId ?? ''}
                  onChange={(e) => updateBookmark(current.id, { groupId: e.target.value || null })}
                  className="h-8 w-full rounded-md border border-border bg-transparent px-1.5 text-sm outline-none focus:ring-1 focus:ring-ring/50"
                >
                  <option value="">{t('chat.browser.bookmarkNoFolder')}</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => { removeByUrl(current.url); setEditOpen(false) }}>
                {t('chat.browser.bookmarkRemove')}
              </Button>
              <Button size="sm" onClick={() => setEditOpen(false)}>
                {t('chat.browser.bookmarkDone')}
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}
