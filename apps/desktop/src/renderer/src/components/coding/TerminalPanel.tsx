import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal as TerminalIcon, Plus, X } from 'lucide-react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { TerminalEvent } from '@superone/shared/agent-types'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { EMPTY_TABS, useTerminalStore } from '@/stores/terminal'
import { useTerminalPanel } from '@/hooks/useTerminalPanel'
import { HoverCloseSlot } from '@/components/activity/ActivityTab'
import { SelectionMenu } from '@/components/chat/SelectionContextMenu'

const HEADER_ITEM = 'flex items-center rounded-lg px-1.5 py-1 transition-colors'

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

  const [menu, setMenu] = useState<{ x: number; y: number; text: string } | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const creatingRef = useRef(false)

  const ensureInstance = useCallback(
    (terminalId: string) => {
      let inst = instances.get(terminalId)
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
      xterm.onData((data) => {
        if (instances.get(terminalId)?.writable === false) return
        void window.terminal.write(terminalId, data)
      })
      inst = { xterm, fit, lastSeq: 0, writable: true, chunks: new Map() }
      instances.set(terminalId, inst)
      return inst
    },
    [instances],
  )

  useEffect(() => {
    const off = window.terminal.onTerminalEvent((event: TerminalEvent) => {
      if (
        event.type !== 'terminal_output' &&
        event.type !== 'terminal_snapshot' &&
        event.type !== 'terminal_snapshot_chunk' &&
        event.type !== 'terminal_owner_changed' &&
        event.type !== 'terminal_exited'
      )
        return
      const inst = instances.get(event.terminalId)
      if (!inst) return
      if (event.type === 'terminal_output') {
        if (event.toSeq <= inst.lastSeq) return
        inst.xterm.write(event.data)
        inst.lastSeq = event.toSeq
      } else if (event.type === 'terminal_snapshot') {
        inst.xterm.reset()
        inst.xterm.write(event.ansi)
        inst.lastSeq = event.snapshot.lastSeq
        inst.writable = event.snapshot.writableByMe
      } else if (event.type === 'terminal_snapshot_chunk') {
        let acc = inst.chunks.get(event.snapshotId)
        if (!acc) {
          acc = { total: event.total, parts: new Map() }
          inst.chunks.set(event.snapshotId, acc)
        }
        acc.parts.set(event.index, event.ansi)
        if (event.snapshot) {
          acc.lastSeq = event.snapshot.lastSeq
          inst.writable = event.snapshot.writableByMe
        }
        if (acc.parts.size === acc.total) {
          const ansi = Array.from({ length: acc.total }, (_, i) => acc!.parts.get(i) ?? '').join('')
          inst.xterm.reset()
          inst.xterm.write(ansi)
          if (acc.lastSeq !== undefined) inst.lastSeq = acc.lastSeq
          inst.chunks.delete(event.snapshotId)
        }
      } else if (event.type === 'terminal_owner_changed') {
        inst.writable = event.writableByMe
      } else if (event.type === 'terminal_exited') {
        inst.xterm.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n')
      }
    })
    return off
  }, [instances])

  const createTerminal = useCallback(async () => {
    if (!projectPath || creatingRef.current) return
    creatingRef.current = true
    try {
      const item = await window.terminal.create({ projectPath, sessionId: sessionId ?? undefined })
      addTab(projectPath, item)
    } finally {
      creatingRef.current = false
    }
  }, [projectPath, sessionId, addTab])

  const closeTab = useCallback(
    (terminalId: string) => {
      void window.terminal.kill(terminalId)
      const inst = instances.get(terminalId)
      inst?.xterm.dispose()
      instances.delete(terminalId)
      if (!projectPath) return
      removeTab(projectPath, terminalId)
      if (tabs.length <= 1) setOpen(false)
    },
    [instances, projectPath, removeTab, tabs.length, setOpen],
  )

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
          {tabs.map((tab) => (
            <div
              key={tab.terminalId}
              onClick={() => projectPath && setActive(projectPath, tab.terminalId)}
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
          onClick={() => setOpen(false)}
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
            const sel = (activeId ? instances.get(activeId) : null)?.xterm.getSelection().trim()
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
