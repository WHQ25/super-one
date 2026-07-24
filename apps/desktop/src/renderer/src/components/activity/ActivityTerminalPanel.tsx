import { useCallback, useEffect, useRef, useState } from 'react'
import { WebglAddon } from '@xterm/addon-webgl'
import { useChatStore } from '@/stores/chat'
import { SelectionMenu } from '@/components/chat/SelectionContextMenu'
import { getTerminalFontFamily, getTerminalFontSize, getTerminalTheme, onTerminalThemeChange } from '@/components/coding/terminal-theme'
import { SEARCH_DECORATIONS } from '@/components/coding/term-instance'
import { TerminalFindBar } from '@/components/coding/TerminalFindBar'
import { createTerminalKeyEventHandler } from '@/components/coding/terminal-keybindings'
import { ensureActivityTermInstance, feedActivityTerminal, getActivityTermInstance } from './activity-terminal'

interface Props {
  terminalId: string
  api: { setTitle: (title: string) => void }
}

export function ActivityTerminalPanel({ terminalId, api }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const addUserSelection = useChatStore((s) => s.addUserSelection)
  const [menu, setMenu] = useState<{ x: number; y: number; text: string } | null>(null)
  const [find, setFind] = useState<string | null>(null)
  const [findHits, setFindHits] = useState({ idx: -1, count: 0 })
  const findInputRef = useRef<HTMLInputElement>(null)
  const openFindRef = useRef<() => void>(() => {})
  const shortcutStateRef = useRef<{
    find: string | null
    runSearch: (query: string, dir: 'next' | 'prev', incremental?: boolean) => void
    closeFind: () => void
  } | null>(null)

  const runSearch = useCallback(
    (query: string, dir: 'next' | 'prev', incremental = false) => {
      const search = getActivityTermInstance(terminalId)?.search
      if (!search) return
      const opts = { incremental, decorations: SEARCH_DECORATIONS }
      if (dir === 'next') search.findNext(query, opts)
      else search.findPrevious(query, opts)
    },
    [terminalId],
  )

  const closeFind = useCallback(() => {
    setFind(null)
    setFindHits({ idx: -1, count: 0 })
    const inst = getActivityTermInstance(terminalId)
    inst?.search.clearDecorations()
    inst?.xterm.focus()
  }, [terminalId])

  openFindRef.current = () => {
    const sel = getActivityTermInstance(terminalId)?.xterm.getSelection().trim()
    setFind((prev) => (sel ? sel : (prev ?? '')))
    requestAnimationFrame(() => findInputRef.current?.select())
  }
  shortcutStateRef.current = { find, runSearch, closeFind }

  // Own PTY listener, filtered by id. The bottom panel's global listener never
  // matches these ids (their instances live in a separate registry).
  useEffect(() => {
    return window.terminal.onTerminalEvent((event) => {
      if (event.terminalId === terminalId) feedActivityTerminal(terminalId, event)
    })
  }, [terminalId])

  useEffect(() => {
    return onTerminalThemeChange(() => {
      const inst = getActivityTermInstance(terminalId)
      if (!inst) return
      const theme = getTerminalTheme()
      const fontSize = getTerminalFontSize()
      const fontFamily = getTerminalFontFamily()
      inst.xterm.options.theme = theme
      const metricsChanged =
        inst.xterm.options.fontSize !== fontSize || inst.xterm.options.fontFamily !== fontFamily
      inst.xterm.options.fontSize = fontSize
      inst.xterm.options.fontFamily = fontFamily
      inst.xterm.clearTextureAtlas()
      if (metricsChanged && inst.xterm.element?.isConnected) {
        inst.fit.fit()
        void window.terminal.resize(terminalId, inst.xterm.cols, inst.xterm.rows)
      }
    })
  }, [terminalId])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const inst = ensureActivityTermInstance(terminalId)
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
    inst.xterm.attachCustomKeyEventHandler(
      createTerminalKeyEventHandler(
        {
          clearSelection: () => inst.xterm.clearSelection(),
          closeFind: () => shortcutStateRef.current?.closeFind(),
          findNext: () => {
            const state = shortcutStateRef.current
            if (!state) return
            const { find, runSearch } = state
            if (find === null) openFindRef.current()
            else runSearch(find, 'next')
          },
          findPrevious: () => {
            const state = shortcutStateRef.current
            if (!state) return
            const { find, runSearch } = state
            if (find === null) openFindRef.current()
            else runSearch(find, 'prev')
          },
          hasSelection: () => inst.xterm.hasSelection(),
          isFindVisible: () => shortcutStateRef.current?.find != null,
          openFind: () => openFindRef.current(),
          sendInput: (data) => inst.xterm.input(data),
        },
        { interceptCtrlW: true },
      ),
    )
    const searchDisp = inst.search.onDidChangeResults((e) =>
      setFindHits({ idx: e.resultIndex, count: e.resultCount }),
    )
    const titleDisp = inst.xterm.onTitleChange((t) => api.setTitle(t))
    inst.fit.fit()
    void window.terminal.snapshot(terminalId)
    void window.terminal.resize(terminalId, inst.xterm.cols, inst.xterm.rows)
    const ro = new ResizeObserver(() => {
      inst.fit.fit()
      void window.terminal.resize(terminalId, inst.xterm.cols, inst.xterm.rows)
    })
    ro.observe(host)
    inst.xterm.focus()
    return () => {
      searchDisp.dispose()
      titleDisp.dispose()
      ro.disconnect()
    }
  }, [terminalId, api])

  return (
    <div className="relative h-full">
      <div
        ref={hostRef}
        className="h-full overflow-hidden p-1"
        onContextMenu={(e) => {
          const sel = getActivityTermInstance(terminalId)?.xterm.getSelection().trim()
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
