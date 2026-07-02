import { useEffect, useRef, useState } from 'react'
import { Globe, Folder, FolderOpen, FolderPlus, FolderMinus, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DndContext, DragOverlay, pointerWithin, PointerSensor, useSensor, useSensors, useDndContext, useDroppable, type CollisionDetection, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { cn } from '@superone/ui/lib/utils'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Button } from '@superone/ui/components/ui/button'
import { Input } from '@superone/ui/components/ui/input'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@superone/ui/components/ui/context-menu'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import type { BrowserBookmark, BrowserBookmarkGroup } from '@superone/shared/agent-types'
import { useBrowserBookmarksStore } from '@/stores/browser-bookmarks'
import { BrowserFavicon } from './BrowserFavicon'

interface BrowserNewTabProps {
  onOpen: (url: string) => void
}

function isDuplicateName(groups: BrowserBookmarkGroup[], name: string, selfId?: string): boolean {
  const norm = name.trim().toLowerCase()
  return groups.some((g) => g.id !== selfId && g.name.trim().toLowerCase() === norm)
}

function EditBookmarkDialog({ open, onOpenChange, bookmark, onSave }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookmark: BrowserBookmark
  onSave: (patch: { title: string; url: string }) => void
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(bookmark.title)
  const [url, setUrl] = useState(bookmark.url)

  useEffect(() => {
    if (open) { setTitle(bookmark.title); setUrl(bookmark.url) }
  }, [open, bookmark.title, bookmark.url])

  const save = () => {
    const nextUrl = url.trim()
    if (!nextUrl) return
    onSave({ title: title.trim() || nextUrl, url: nextUrl })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('chat.browser.bookmarkEdit')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t('chat.browser.bookmarkName')}</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t('chat.browser.bookmarkUrl')}</span>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) save() }}
            />
          </label>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t('common.cancel')}</Button>
          </DialogClose>
          <Button onClick={save} disabled={!url.trim()}>{t('common.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GroupNameDialog({ open, onOpenChange, mode, initialName, groups, selfId, onSubmit }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'rename'
  initialName: string
  groups: BrowserBookmarkGroup[]
  selfId?: string
  onSubmit: (name: string) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initialName)

  useEffect(() => { if (open) setName(initialName) }, [open, initialName])

  const trimmed = name.trim()
  const duplicate = trimmed.length > 0 && isDuplicateName(groups, trimmed, selfId)
  const valid = trimmed.length > 0 && !duplicate

  const submit = () => {
    if (!valid) return
    onSubmit(trimmed)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t(mode === 'create' ? 'chat.browser.newFolder' : 'chat.browser.renameFolder')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1.5 py-2">
          <Input
            value={name}
            autoFocus
            placeholder={t('chat.browser.folderNamePlaceholder')}
            aria-invalid={duplicate}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit() }}
          />
          {duplicate && <p className="text-xs text-destructive">{t('chat.browser.folderExists')}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t('common.cancel')}</Button>
          </DialogClose>
          <Button onClick={submit} disabled={!valid}>{t('common.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const tileClass = 'flex min-w-0 max-w-[220px] items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted'
const UNGROUP_ZONE = 'browser-bookmarks-ungroup-zone'

// Pointer-based hit-testing so the drop target follows the cursor exactly (closestCenter mis-resolves under a DragOverlay
// with no live reorder). Exclude the dragged item itself — near a tile boundary the pointer sits over both self and the
// neighbour, and if self wins `over === active` and the drop is a no-op (this is why folder reorder appeared dead).
// The full-area ungroup zone only wins when the pointer is over genuinely empty space, not merely hovering its own tile.
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  const tiles = hits.filter((h) => h.id !== UNGROUP_ZONE && h.id !== args.active.id)
  if (tiles.length) return tiles
  const overSelf = hits.some((h) => h.id === args.active.id)
  return overSelf ? [] : hits.filter((h) => h.id === UNGROUP_ZONE)
}

type SortableHandle = Pick<ReturnType<typeof useSortable>, 'setNodeRef' | 'attributes' | 'listeners' | 'isDragging'> & {
  axis: 'x' | 'y'
  indicator: 'before' | 'after' | null
}

function dropIndicator(sortable: ReturnType<typeof useSortable>, selfId: string): 'before' | 'after' | null {
  const { isOver, active, activeIndex, index } = sortable
  if (!isOver || !active || active.id === selfId) return null
  return activeIndex !== -1 && activeIndex < index ? 'after' : 'before'
}

function DropLine({ axis, dir }: { axis: 'x' | 'y'; dir: 'before' | 'after' }) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute z-10 rounded-full bg-primary',
        axis === 'x'
          ? cn('top-1 bottom-1 w-0.5', dir === 'before' ? '-left-px' : '-right-px')
          : cn('left-1 right-1 h-0.5', dir === 'before' ? '-top-px' : '-bottom-px'),
      )}
    />
  )
}

function UngroupZone({ children }: { children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: UNGROUP_ZONE })
  return <div ref={setNodeRef} className="flex flex-wrap justify-center gap-0.5">{children}</div>
}

function BookmarkTile({ bookmark, onOpen, onSave, onRemove, onUngroup, dnd }: {
  bookmark: BrowserBookmark
  onOpen: () => void
  onSave: (patch: { title: string; url: string }) => void
  onRemove: () => void
  onUngroup?: () => void
  dnd?: SortableHandle
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)

  return (
    <div ref={dnd?.setNodeRef} className="relative">
      {dnd?.indicator && <DropLine axis={dnd.axis} dir={dnd.indicator} />}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            {...dnd?.attributes}
            {...dnd?.listeners}
            onClick={onOpen}
            className={cn(tileClass, dnd?.isDragging && 'opacity-40')}
          >
            <span className="flex size-6 shrink-0 items-center justify-center">
              <BrowserFavicon src={bookmark.favicon} url={bookmark.url} className="size-4" fallback={<Globe className="size-4 text-muted-foreground" />} />
            </span>
            <span className="min-w-0 truncate text-[13px] leading-tight">{bookmark.title || bookmark.url}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => setEditing(true)}>
            <Pencil className="size-3.5" />
            {t('chat.browser.bookmarkEdit')}
          </ContextMenuItem>
          {onUngroup && (
            <ContextMenuItem onSelect={onUngroup}>
              <FolderMinus className="size-3.5" />
              {t('chat.browser.removeFromFolder')}
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={onRemove}>
            <Trash2 className="size-3.5" />
            {t('chat.browser.bookmarkRemove')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <EditBookmarkDialog open={editing} onOpenChange={setEditing} bookmark={bookmark} onSave={onSave} />
    </div>
  )
}

function SortableBookmarkTile({ axis = 'x', ...props }: {
  bookmark: BrowserBookmark
  onOpen: () => void
  onSave: (patch: { title: string; url: string }) => void
  onRemove: () => void
  onUngroup?: () => void
  axis?: 'x' | 'y'
}) {
  const sortable = useSortable({ id: props.bookmark.id })
  const { attributes, listeners, setNodeRef, isDragging } = sortable
  return (
    <BookmarkTile
      {...props}
      dnd={{
        setNodeRef,
        isDragging,
        attributes,
        listeners,
        axis,
        indicator: dropIndicator(sortable, props.bookmark.id),
      }}
    />
  )
}

function FolderTile({ group, bookmarks, groups, onOpenBookmark, onSaveBookmark, onRemoveBookmark, onUngroupBookmark, onRename, onRemove }: {
  group: BrowserBookmarkGroup
  bookmarks: BrowserBookmark[]
  groups: BrowserBookmarkGroup[]
  onOpenBookmark: (url: string) => void
  onSaveBookmark: (id: string, patch: { title: string; url: string }) => void
  onRemoveBookmark: (id: string) => void
  onUngroupBookmark: (id: string) => void
  onRename: (name: string) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const sortable = useSortable({ id: group.id })
  const { attributes, listeners, setNodeRef, isDragging } = sortable
  const { active } = useDndContext()
  const activeIsGroup = !!active && groups.some((g) => g.id === active.id)
  const isDropTarget = sortable.isOver && !!active && !activeIsGroup
  const indicator = activeIsGroup ? dropIndicator(sortable, group.id) : null
  const closeAfterDrag = useRef(false)

  // Spring-loaded folder: hovering a dragged bookmark over the tile for a beat expands it to pick a position
  useEffect(() => {
    if (!isDropTarget || popoverOpen) return
    const timer = setTimeout(() => setPopoverOpen(true), 600)
    return () => clearTimeout(timer)
  }, [isDropTarget, popoverOpen])

  // Any drag that happens while the folder is open should close it on drop
  useEffect(() => {
    if (active && popoverOpen) closeAfterDrag.current = true
  }, [active, popoverOpen])

  useEffect(() => {
    if (!active && closeAfterDrag.current) { closeAfterDrag.current = false; setPopoverOpen(false) }
  }, [active])

  return (
    <div ref={setNodeRef} className="relative">
      {indicator && <DropLine axis="x" dir={indicator} />}
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                {...attributes}
                {...listeners}
                className={cn(
                  tileClass,
                  isDragging && 'opacity-40',
                  isDropTarget && 'bg-accent ring-2 ring-primary',
                )}
              >
                <span className="flex size-6 shrink-0 items-center justify-center">
                  {popoverOpen
                    ? <FolderOpen className="size-4 text-muted-foreground" />
                    : <Folder className="size-4 text-muted-foreground" />}
                </span>
                <span className="min-w-0 truncate text-[13px] leading-tight">{group.name}</span>
              </button>
            </PopoverTrigger>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => setRenaming(true)}>
              <Pencil className="size-3.5" />
              {t('chat.browser.renameFolder')}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={onRemove}>
              <Trash2 className="size-3.5" />
              {t('chat.browser.deleteFolder')}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <PopoverContent align="start" onOpenAutoFocus={(e) => e.preventDefault()} className="w-max min-w-[160px] max-w-[280px] p-1">
          {bookmarks.length === 0 ? (
            <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">{t('chat.browser.emptyFolder')}</p>
          ) : (
            <SortableContext items={bookmarks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-0.5">
                {bookmarks.map((b) => (
                  <SortableBookmarkTile
                    key={b.id}
                    axis="y"
                    bookmark={b}
                    onOpen={() => { onOpenBookmark(b.url); setPopoverOpen(false) }}
                    onSave={(patch) => onSaveBookmark(b.id, patch)}
                    onRemove={() => onRemoveBookmark(b.id)}
                    onUngroup={() => onUngroupBookmark(b.id)}
                  />
                ))}
              </div>
            </SortableContext>
          )}
        </PopoverContent>
      </Popover>
      <GroupNameDialog
        open={renaming}
        onOpenChange={setRenaming}
        mode="rename"
        initialName={group.name}
        groups={groups}
        selfId={group.id}
        onSubmit={onRename}
      />
    </div>
  )
}

export function BrowserNewTab({ onOpen }: BrowserNewTabProps) {
  const { t } = useTranslation()
  const bookmarks = useBrowserBookmarksStore((s) => s.bookmarks)
  const groups = useBrowserBookmarksStore((s) => s.groups)
  const loaded = useBrowserBookmarksStore((s) => s.loaded)
  const { load, updateBookmark, removeBookmark, moveBookmarkToGroup, moveBookmark, reorderGroups, addGroup, renameGroup, removeGroup } = useBrowserBookmarksStore.getState()
  const [creating, setCreating] = useState(false)
  const [dragging, setDragging] = useState<{ id: string; kind: 'bookmark' | 'group' } | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  useEffect(() => { if (!loaded) void load() }, [loaded, load])

  const ungrouped = bookmarks.filter((b) => !b.groupId)
  const byGroup = (id: string): BrowserBookmark[] => bookmarks.filter((b) => b.groupId === id)

  const onDragStart = ({ active }: DragStartEvent) => {
    const kind = groups.some((g) => g.id === active.id) ? 'group' : 'bookmark'
    setDragging({ id: String(active.id), kind })
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null)
    if (!over || active.id === over.id) return
    const activeId = String(active.id)
    const overId = String(over.id)

    if (groups.some((g) => g.id === activeId)) {
      if (groups.some((g) => g.id === overId)) reorderGroups(activeId, overId)
      return
    }

    // active is a bookmark — a single drag decides both its group and its position
    const overGroup = groups.find((g) => g.id === overId)
    if (overGroup) { moveBookmark(activeId, overGroup.id, null); return }
    if (overId === UNGROUP_ZONE) { moveBookmark(activeId, null, null); return }
    const overBookmark = bookmarks.find((b) => b.id === overId)
    if (overBookmark) {
      const targetGroup = overBookmark.groupId ?? null
      const fromIdx = bookmarks.findIndex((b) => b.id === activeId)
      const toIdx = bookmarks.findIndex((b) => b.id === overId)
      const sameGroup = (bookmarks[fromIdx]?.groupId ?? null) === targetGroup
      const side = sameGroup && fromIdx < toIdx ? 'after' : 'before'
      moveBookmark(activeId, targetGroup, overId, side)
    }
  }

  const draggingBookmark = dragging?.kind === 'bookmark' ? bookmarks.find((b) => b.id === dragging.id) : null
  const draggingGroup = dragging?.kind === 'group' ? groups.find((g) => g.id === dragging.id) : null

  return (
    <div className="h-full w-full overflow-y-auto bg-transparent">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col px-6 py-10">
        <div className="grow-[4]" />
        <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <section>
            <div className="mb-3 flex items-center justify-center gap-2">
              <h2 className="text-sm font-semibold">{t('chat.browser.bookmarks')}</h2>
              <IconButton size="xs" variant="ghost" tooltip={t('chat.browser.newFolder')} onClick={() => setCreating(true)}>
                <FolderPlus className="size-3.5" />
              </IconButton>
            </div>
            {ungrouped.length === 0 && (
              <p className="mb-6 text-xs text-muted-foreground">{t('chat.browser.noBookmarks')}</p>
            )}
            <UngroupZone>
              <SortableContext items={ungrouped.map((b) => b.id)} strategy={rectSortingStrategy}>
                {ungrouped.map((b) => (
                  <SortableBookmarkTile
                    key={b.id}
                    bookmark={b}
                    onOpen={() => onOpen(b.url)}
                    onSave={(patch) => updateBookmark(b.id, patch)}
                    onRemove={() => removeBookmark(b.id)}
                  />
                ))}
              </SortableContext>
            </UngroupZone>
          </section>

          <section className="mt-0.5">
            <div className="flex flex-wrap justify-center gap-0.5">
              <SortableContext items={groups.map((g) => g.id)} strategy={rectSortingStrategy}>
                {groups.map((g) => (
                  <FolderTile
                    key={g.id}
                    group={g}
                    bookmarks={byGroup(g.id)}
                    groups={groups}
                    onOpenBookmark={onOpen}
                    onSaveBookmark={(id, patch) => updateBookmark(id, patch)}
                    onRemoveBookmark={removeBookmark}
                    onUngroupBookmark={(id) => moveBookmarkToGroup(id, null)}
                    onRename={(name) => renameGroup(g.id, name)}
                    onRemove={() => removeGroup(g.id)}
                  />
                ))}
              </SortableContext>
            </div>
          </section>

            <DragOverlay>
              {draggingBookmark && (
                <div className={cn(tileClass, 'bg-popover shadow-lg')}>
                  <span className="flex size-6 shrink-0 items-center justify-center">
                    <BrowserFavicon src={draggingBookmark.favicon} url={draggingBookmark.url} className="size-4" fallback={<Globe className="size-4 text-muted-foreground" />} />
                  </span>
                  <span className="min-w-0 truncate text-[13px] leading-tight">{draggingBookmark.title || draggingBookmark.url}</span>
                </div>
              )}
              {draggingGroup && (
                <div className={cn(tileClass, 'bg-popover shadow-lg')}>
                  <span className="flex size-6 shrink-0 items-center justify-center">
                    <Folder className="size-4 text-muted-foreground" />
                  </span>
                  <span className="min-w-0 truncate text-[13px] leading-tight">{draggingGroup.name}</span>
                </div>
              )}
            </DragOverlay>
        </DndContext>
        <div className="grow-[6]" />
      </div>

      <GroupNameDialog
        open={creating}
        onOpenChange={setCreating}
        mode="create"
        initialName=""
        groups={groups}
        onSubmit={(name) => addGroup(name)}
      />
    </div>
  )
}
