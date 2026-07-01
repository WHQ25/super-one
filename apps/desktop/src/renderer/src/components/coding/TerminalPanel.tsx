import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal as TerminalIcon, Plus, PanelBottomClose } from 'lucide-react'
import { WebglAddon } from '@xterm/addon-webgl'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { setCloseActiveTerminal, setCreateTerminal } from './terminal-panel-api'
import { getTerminalFontFamily, getTerminalFontSize, getTerminalTheme, onTerminalThemeChange } from './terminal-theme'
import { applyTerminalEvent, createBaseXterm, disposeTermInstance, SEARCH_DECORATIONS } from './term-instance'
import { TerminalFindBar } from './TerminalFindBar'
import type { TerminalEvent, TerminalListItem } from '@superone/shared/agent-types'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { EMPTY_TABS, useTerminalStore } from '@/stores/terminal'
import { useTerminalPanel } from '@/hooks/useTerminalPanel'
import { HoverCloseSlot } from '@/components/activity/ActivityTab'
import { SelectionMenu } from '@/components/chat/SelectionContextMenu'

const HEADER_ITEM = 'flex items-center rounded-lg px-1.5 py-1 transition-colors'

function SortableTerminalTab({
  tab,
  active,
  onActivate,
  onClose,
}: {
  tab: TerminalListItem
  active: boolean
  onActivate: () => void
  onClose: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.terminalId,
  })
  const style = {
    transform: CSS.Transform.toString(transform ? { ...transform, y: 0 } : null),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onActivate}
      className={`${HEADER_ITEM} gap-1.5 shrink-0 cursor-pointer ${
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
      } ${isDragging ? 'z-10 opacity-80' : ''}`}
    >
      <HoverCloseSlot onClose={onClose}>
        <TerminalIcon className="size-3 shrink-0" />
      </HoverCloseSlot>
      <span className="max-w-40 truncate text-xs">{tab.title}</span>
    </div>
  )
}

export function TerminalPanel() {
  const projectPath = useAppStore((s) => s.currentFolder)
  const { sessionId, open, setOpen } = useTerminalPanel()

  const addUserSelection = useChatStore((s) => s.addUserSelection)
  const instances = useTerminalStore((s) => s.instances)
  const tabs = useTerminalStore((s) => (projectPath ? s.byProject[projectPath]?.tabs : null) ?? EMPTY_TABS)
  const activeId = useTerminalStore((s) => (projectPath ? s.byProject[projectPath]?.activeId : null) ?? null)
  const addTab = useTerminalStore((s) => s.addTab)
  const removeTab = useTerminalStore((s) => s.removeTab)
  const setActive = useTerminalStore((s) => s.setActive)
  const renameTab = useTerminalStore((s) => s.renameTab)
  const reorderTabs = useTerminalStore((s) => s.reorderTabs)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const handleTabDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e
      if (!over || active.id === over.id || !projectPath) return
      reorderTabs(projectPath, active.id as string, over.id as string)
    },
    [projectPath, reorderTabs],
  )

  const [menu, setMenu] = useState<{ x: number; y: number; text: string } | null>(null)
  const [find, setFind] = useState<string | null>(null)
  const [findHits, setFindHits] = useState({ idx: -1, count: 0 })
  const themeRef = useRef(getTerminalTheme())
  const hostRef = useRef<HTMLDivElement>(null)
  const findInputRef = useRef<HTMLInputElement>(null)
  const openFindRef = useRef<() => void>(() => {})
  const creatingRef = useRef(false)

  const runSearch = useCallback(
    (query: string, dir: 'next' | 'prev', incremental = false) => {
      const search = (activeId ? instances.get(activeId) : null)?.search
      if (!search) return
      const opts = { incremental, decorations: SEARCH_DECORATIONS }
      if (dir === 'next') search.findNext(query, opts)
      else search.findPrevious(query, opts)
    },
    [activeId, instances],
  )

  const closeFind = useCallback(() => {
    setFind(null)
    setFindHits({ idx: -1, count: 0 })
    const inst = activeId ? instances.get(activeId) : null
    inst?.search.clearDecorations()
    inst?.xterm.focus()
  }, [activeId, instances])

  openFindRef.current = () => {
    const sel = (activeId ? instances.get(activeId) : null)?.xterm.getSelection().trim()
    setFind((prev) => (sel ? sel : (prev ?? '')))
    requestAnimationFrame(() => findInputRef.current?.select())
  }

  const ensureInstance = useCallback(
    (terminalId: string) => {
      let inst = instances.get(terminalId)
      if (inst) return inst
      const { xterm, fit, search } = createBaseXterm()
      search.onDidChangeResults((e) => setFindHits({ idx: e.resultIndex, count: e.resultCount }))
      xterm.attachCustomKeyEventHandler((e) => {
        if (e.type === 'keydown' && (e.metaKey || e.ctrlKey)) {
          if (e.key === 'f') {
            openFindRef.current()
            return false
          }
          if (e.key === 'w' && e.metaKey) return false
        }
        return true
      })
      xterm.onData((data) => {
        if (instances.get(terminalId)?.writable === false) return
        void window.terminal.write(terminalId, data)
      })
      xterm.onTitleChange((t) => renameTab(terminalId, t))
      inst = { xterm, fit, search, lastSeq: 0, writable: true, chunks: new Map() }
      instances.set(terminalId, inst)
      return inst
    },
    [instances, renameTab],
  )

  useEffect(() => {
    return onTerminalThemeChange(() => {
      const theme = getTerminalTheme()
      const fontSize = getTerminalFontSize()
      const fontFamily = getTerminalFontFamily()
      themeRef.current = theme
      for (const [terminalId, inst] of instances.entries()) {
        if (!inst.xterm.options.allowTransparency) inst.xterm.options.allowTransparency = true
        inst.xterm.options.theme = theme
        const metricsChanged =
          inst.xterm.options.fontSize !== fontSize || inst.xterm.options.fontFamily !== fontFamily
        if (inst.xterm.options.fontSize !== fontSize) inst.xterm.options.fontSize = fontSize
        if (inst.xterm.options.fontFamily !== fontFamily) inst.xterm.options.fontFamily = fontFamily
        inst.xterm.clearTextureAtlas()
        if (metricsChanged && inst.xterm.element?.isConnected) {
          inst.fit.fit()
          void window.terminal.resize(terminalId, inst.xterm.cols, inst.xterm.rows)
        }
      }
    })
  }, [instances])

  useEffect(() => {
    const off = window.terminal.onTerminalEvent((event: TerminalEvent) => {
      if (!event.terminalId) return
      const inst = instances.get(event.terminalId)
      if (!inst) return
      applyTerminalEvent(inst, event)
    })
    return off
  }, [instances])

  const createTerminal = useCallback(async () => {
    if (!projectPath || creatingRef.current) return
    creatingRef.current = true
    try {
      const item = await window.terminal.create({ projectPath, sessionId: sessionId ?? undefined })
      addTab(projectPath, item)
      creatingRef.current = false
    } catch (e) {
      creatingRef.current = false
      throw e
    }
  }, [projectPath, sessionId, addTab])

  const closeTab = useCallback(
    (terminalId: string) => {
      void window.terminal.kill(terminalId)
      const inst = instances.get(terminalId)
      if (inst) disposeTermInstance(inst)
      instances.delete(terminalId)
      if (!projectPath) return
      removeTab(projectPath, terminalId)
      if (tabs.length <= 1) setOpen(false)
    },
    [instances, projectPath, removeTab, tabs.length, setOpen],
  )

  useEffect(() => {
    setCloseActiveTerminal(activeId ? () => closeTab(activeId) : null)
    return () => setCloseActiveTerminal(null)
  }, [activeId, closeTab])

  useEffect(() => {
    setCreateTerminal(() => void createTerminal())
    return () => setCreateTerminal(null)
  }, [createTerminal])

  useEffect(() => {
    if (open && projectPath && tabs.length === 0 && !creatingRef.current) {
      void createTerminal()
    }
  }, [open, projectPath, tabs.length, createTerminal])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    if (!activeId) {
      host.replaceChildren()
      return
    }
    const inst = ensureInstance(activeId)
    if (inst.xterm.element) {
      host.replaceChildren(inst.xterm.element)
    } else {
      host.replaceChildren()
      inst.xterm.open(host)
      try {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => {
          try {
            webgl.dispose()
          } catch {
            /* renderer internals already gone — xterm reverts to the DOM renderer */
          }
          inst.webgl = undefined
        })
        inst.xterm.loadAddon(webgl)
        inst.webgl = webgl
        inst.xterm.clearTextureAtlas()
      } catch {
        /* WebGL unavailable — xterm falls back to the DOM renderer */
      }
    }
    inst.fit.fit()
    void window.terminal.snapshot(activeId)
    void window.terminal.resize(activeId, inst.xterm.cols, inst.xterm.rows)
    const ro = new ResizeObserver(() => {
      inst.fit.fit()
      void window.terminal.resize(activeId, inst.xterm.cols, inst.xterm.rows)
    })
    ro.observe(host)
    inst.xterm.focus()
    return () => ro.disconnect()
  }, [activeId, projectPath, ensureInstance])

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleTabDragEnd}>
            <SortableContext
              items={tabs.map((t) => t.terminalId)}
              strategy={horizontalListSortingStrategy}
            >
              {tabs.map((tab) => (
                <SortableTerminalTab
                  key={tab.terminalId}
                  tab={tab}
                  active={tab.terminalId === activeId}
                  onActivate={() => projectPath && setActive(projectPath, tab.terminalId)}
                  onClose={() => closeTab(tab.terminalId)}
                />
              ))}
            </SortableContext>
          </DndContext>
          <button
            onClick={() => void createTerminal()}
            disabled={!projectPath}
            className={`${HEADER_ITEM} shrink-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40`}
            title="New terminal"
          >
            <Plus className="size-4" />
          </button>
        </div>
        <button
          onClick={() => setOpen(false)}
          className={`${HEADER_ITEM} shrink-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground`}
          title="Hide terminal (⌘J)"
        >
          <PanelBottomClose className="size-4" />
        </button>
      </div>
      {tabs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          {projectPath ? 'No terminal — click + to start one' : 'Open a project to use the terminal'}
        </div>
      ) : (
        <div className="relative min-h-0 flex-1">
          <div
            ref={hostRef}
            className="h-full overflow-hidden p-1"
            onContextMenu={(e) => {
              const sel = (activeId ? instances.get(activeId) : null)?.xterm.getSelection().trim()
              if (!sel) return
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, text: sel })
            }}
          />
          {find !== null && (
            <TerminalFindBar
              value={find}
              onChange={(v) => { setFind(v); runSearch(v, 'next', true) }}
              hits={findHits}
              onNext={() => runSearch(find, 'next')}
              onPrev={() => runSearch(find, 'prev')}
              onClose={closeFind}
              inputRef={findInputRef}
            />
          )}
        </div>
      )}
      {menu && (
        <SelectionMenu
          pos={{ x: menu.x, y: menu.y }}
          onCopy={() => void navigator.clipboard.writeText(menu.text)}
          onAddToChat={() => addUserSelection('```\n' + menu.text + '\n```')}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
