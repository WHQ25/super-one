import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal as TerminalIcon, Plus, X } from 'lucide-react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { TerminalEvent, TerminalListItem } from '@superone/shared/agent-types'
import { useAppStore } from '@/stores/app'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { HoverCloseSlot } from '@/components/activity/ActivityTab'
import { SelectionMenu } from '@/components/chat/SelectionContextMenu'

const HEADER_ITEM = 'flex items-center rounded-lg px-1.5 py-1 transition-colors'

interface TermInstance {
  xterm: XTerm
  fit: FitAddon
  lastSeq: number
  chunks: Map<string, { total: number; parts: Map<number, string> }>
}

export function TerminalPanel() {
  const projectPath = useAppStore((s) => s.currentFolder)
  const terminalOpen = useAppStore((s) => s.terminalOpen)
  const setTerminalOpen = useAppStore((s) => s.setTerminalOpen)
  const sessionId = useActiveSession((s) => s._activeSessionId) as string | null

  const addUserSelection = useChatStore((s) => s.addUserSelection)
  const [tabs, setTabs] = useState<TerminalListItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; text: string } | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const instances = useRef(new Map<string, TermInstance>())
  const creatingRef = useRef(false)

  const ensureInstance = useCallback((terminalId: string): TermInstance => {
    let inst = instances.current.get(terminalId)
    if (inst) return inst
    const xterm = new XTerm({
      fontSize: 14,
      fontFamily: 'Monaco, ui-monospace, SFMono-Regular, Menlo, monospace',
      cursorBlink: true,
      allowProposedApi: true,
      theme: { background: '#00000000' },
    })
    const fit = new FitAddon()
    xterm.loadAddon(fit)
    xterm.onData((data) => void window.terminal.write(terminalId, data))
    inst = { xterm, fit, lastSeq: 0, chunks: new Map() }
    instances.current.set(terminalId, inst)
    return inst
  }, [])

  useEffect(() => {
    const off = window.terminal.onTerminalEvent((event: TerminalEvent) => {
      if (
        event.type !== 'terminal_output' &&
        event.type !== 'terminal_snapshot' &&
        event.type !== 'terminal_snapshot_chunk' &&
        event.type !== 'terminal_exited'
      )
        return
      const inst = instances.current.get(event.terminalId)
      if (!inst) return
      if (event.type === 'terminal_output') {
        if (event.toSeq <= inst.lastSeq) return
        inst.xterm.write(event.data)
        inst.lastSeq = event.toSeq
      } else if (event.type === 'terminal_snapshot') {
        inst.xterm.reset()
        inst.xterm.write(event.ansi)
        inst.lastSeq = event.snapshot.lastSeq
      } else if (event.type === 'terminal_snapshot_chunk') {
        let acc = inst.chunks.get(event.snapshotId)
        if (!acc) {
          acc = { total: event.total, parts: new Map() }
          inst.chunks.set(event.snapshotId, acc)
        }
        acc.parts.set(event.index, event.ansi)
        if (acc.parts.size === acc.total) {
          const ansi = Array.from({ length: acc.total }, (_, i) => acc!.parts.get(i) ?? '').join('')
          inst.xterm.reset()
          inst.xterm.write(ansi)
          if (event.snapshot) inst.lastSeq = event.snapshot.lastSeq
          inst.chunks.delete(event.snapshotId)
        }
      } else if (event.type === 'terminal_exited') {
        inst.xterm.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n')
      }
    })
    return off
  }, [])

  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const prevOpenRef = useRef(false)

  const createTerminal = useCallback(async () => {
    if (!projectPath || creatingRef.current) return
    creatingRef.current = true
    try {
      const item = await window.terminal.create({ projectPath, sessionId: sessionId ?? undefined })
      setTabs((t) => [...t, item])
      setActiveId(item.terminalId)
    } finally {
      creatingRef.current = false
    }
  }, [projectPath, sessionId])

  const closeTab = useCallback(
    (terminalId: string) => {
      void window.terminal.kill(terminalId)
      const inst = instances.current.get(terminalId)
      inst?.xterm.dispose()
      instances.current.delete(terminalId)
      const remaining = tabsRef.current.filter((x) => x.terminalId !== terminalId)
      setTabs(remaining)
      setActiveId((cur) => (cur === terminalId ? (remaining[remaining.length - 1]?.terminalId ?? null) : cur))
      if (remaining.length === 0) setTerminalOpen(false)
    },
    [setTerminalOpen],
  )

  useEffect(() => {
    const opened = terminalOpen && !prevOpenRef.current
    prevOpenRef.current = terminalOpen
    if (opened && projectPath && tabsRef.current.length === 0 && !creatingRef.current) {
      void createTerminal()
    }
  }, [terminalOpen, projectPath, createTerminal])

  useEffect(() => {
    if (!activeId || !hostRef.current) return
    const inst = ensureInstance(activeId)
    const host = hostRef.current
    host.replaceChildren()
    inst.xterm.open(host)
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
  }, [activeId, ensureInstance])

  useEffect(() => {
    return () => {
      for (const inst of instances.current.values()) inst.xterm.dispose()
      instances.current.clear()
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <div
              key={tab.terminalId}
              onClick={() => setActiveId(tab.terminalId)}
              className={`${HEADER_ITEM} gap-1.5 shrink-0 cursor-pointer ${
                tab.terminalId === activeId
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <HoverCloseSlot onClose={() => closeTab(tab.terminalId)}>
                <TerminalIcon className="size-3 shrink-0" />
              </HoverCloseSlot>
              <span className="max-w-40 truncate text-xs">{tab.title}</span>
            </div>
          ))}
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
          onClick={() => setTerminalOpen(false)}
          className={`${HEADER_ITEM} shrink-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground`}
          title="Hide terminal (⌘J)"
        >
          <X className="size-4" />
        </button>
      </div>
      {tabs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          {projectPath ? 'No terminal — click + to start one' : 'Open a project to use the terminal'}
        </div>
      ) : (
        <div
          ref={hostRef}
          className="min-h-0 flex-1 overflow-hidden p-1"
          onContextMenu={(e) => {
            const sel = (activeId ? instances.current.get(activeId) : null)?.xterm.getSelection().trim()
            if (!sel) return
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, text: sel })
          }}
        />
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
