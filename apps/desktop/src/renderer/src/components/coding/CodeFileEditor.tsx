import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { useIsDark } from '@/hooks/use-is-dark'
import { isAbsoluteLocalPath } from '@/lib/file-link'
import { inferLanguage, splitContentLines, useHighlightedTokens } from '@/lib/diff-utils'
import { getHighlightCache } from '@/lib/highlight-cache'
import { useAppStore, useEffectiveProjectRoot } from '@/stores/app'
import { useSourceControlStore } from '@/stores/source-control'
import { CodeMinimap } from './CodeMinimap'
import { FileSelectionContextMenuZone } from './FileSelectionContextMenuZone'
import {
  attachHorizontalGutterClip,
  captureViewSelection,
  createLineNumbersController,
  scrollViewToLineWithFlash,
  type LineNumbersController,
} from './cm-editor-helpers'
import { createShikiExtension } from './cm-shiki'
import { codeEditorTheme } from './cm-theme'
import { loadVimExtension } from './cm-vim'
import {
  createDiffGutterExtensions,
  flashLineField,
  setDiffChangesEffect,
  type GutterHoverPayload,
} from './cm-diff-gutter'
import { DiffHunkHoverCard } from './DiffHunkHoverCard'
import {
  buildEditorMinimapLines,
  computeLiveDiffChanges,
  parseEditorDiffChanges,
  reconstructBaseContent,
  revertDiffChange,
  type EditorDiffChange,
} from './editor-diff'

const AUTOSAVE_DELAY = 1000
const HOVER_CLOSE_DELAY = 150
const LARGE_DIFF_LINE_THRESHOLD = 2000

export interface CodeFileEditorProps {
  content: string
  diskContent: string
  gitDiff: string
  filePath: string
  fileRoot?: string | null
  onDirtyChange?: (dirty: boolean) => void
  onContentChange?: (text: string) => void
  onSaved?: (text: string) => void
}

export function CodeFileEditor({
  content,
  diskContent,
  gitDiff,
  filePath,
  fileRoot: rootProp,
  onDirtyChange,
  onContentChange,
  onSaved,
}: CodeFileEditorProps) {
  const effectiveRoot = useEffectiveProjectRoot()
  const fileRoot = rootProp ?? effectiveRoot
  const fullFilePath = isAbsoluteLocalPath(filePath) ? filePath : fileRoot ? `${fileRoot}/${filePath}` : filePath
  const isDark = useIsDark()
  const editorVimMode = useAppStore((s) => s.editorVimMode)
  const editorRelativeLineNumbers = useAppStore((s) => s.editorRelativeLineNumbers)
  const language = useMemo(() => inferLanguage(filePath), [filePath])
  const scrollToLine = useSourceControlStore((s) => s.scrollToLine)

  const hostRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const lineNumbersControllerRef = useRef<LineNumbersController | null>(null)
  const shikiCompartmentRef = useRef(new Compartment())
  const vimCompartmentRef = useRef(new Compartment())
  const vimActiveRef = useRef(false)

  const [liveText, setLiveText] = useState(content)
  const [debouncedLiveText, setDebouncedLiveText] = useState(content)
  const [isDirty, setIsDirty] = useState(false)
  const [overflowsPage, setOverflowsPage] = useState(false)
  const [editorDom, setEditorDom] = useState<HTMLElement | null>(null)
  const [hoveredTarget, setHoveredTarget] = useState<GutterHoverPayload | null>(null)
  const hoveredTargetRef = useRef<GutterHoverPayload | null>(null)
  hoveredTargetRef.current = hoveredTarget

  const savedContentRef = useRef(diskContent)
  const latestTextRef = useRef(content)
  const emittedTextRef = useRef<string | null>(null)
  const savingRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cardHoveredRef = useRef(false)
  const fileRootRef = useRef(fileRoot)
  const filePathRef = useRef(filePath)
  const onDirtyChangeRef = useRef(onDirtyChange)
  const onContentChangeRef = useRef(onContentChange)
  const onSavedRef = useRef(onSaved)

  fileRootRef.current = fileRoot
  filePathRef.current = filePath
  onDirtyChangeRef.current = onDirtyChange
  onContentChangeRef.current = onContentChange
  onSavedRef.current = onSaved

  useEffect(() => {
    savedContentRef.current = diskContent
  }, [diskContent])

  useEffect(() => {
    const lineCount = splitContentLines(liveText).length
    if (lineCount <= LARGE_DIFF_LINE_THRESHOLD) {
      setDebouncedLiveText(liveText)
      return
    }
    const id = setTimeout(() => setDebouncedLiveText(liveText), 120)
    return () => clearTimeout(id)
  }, [liveText])

  const baseContent = useMemo(
    () => reconstructBaseContent(diskContent, gitDiff),
    [diskContent, gitDiff],
  )

  const diffChanges = useMemo<EditorDiffChange[]>(() => {
    if (debouncedLiveText === diskContent) {
      return parseEditorDiffChanges(gitDiff, splitContentLines(diskContent).length)
    }
    return computeLiveDiffChanges(baseContent, debouncedLiveText)
  }, [baseContent, debouncedLiveText, diskContent, gitDiff])

  const highlightCache = useMemo(() => getHighlightCache(fileRoot ?? null), [fileRoot])
  const minimapTokens = useHighlightedTokens(overflowsPage ? debouncedLiveText : '', language, { cache: highlightCache })
  const minimapLines = useMemo(
    () => (overflowsPage ? buildEditorMinimapLines(debouncedLiveText, diffChanges) : []),
    [overflowsPage, debouncedLiveText, diffChanges],
  )

  const saveNow = useCallback(async (textToSave: string) => {
    const root = fileRootRef.current
    const path = filePathRef.current
    if (!root || !window.app.saveFile) return
    if (textToSave === savedContentRef.current) return
    savingRef.current = true
    try {
      const result = await window.app.saveFile(root, path, textToSave)
      if (result.ok) {
        savedContentRef.current = textToSave
        const stillDirty = latestTextRef.current !== textToSave
        setIsDirty(stillDirty)
        onDirtyChangeRef.current?.(stillDirty)
        onSavedRef.current?.(textToSave)
      }
    } finally {
      savingRef.current = false
    }
  }, [])

  const triggerImmediateSave = useCallback((targetView: EditorView) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    void saveNow(targetView.state.doc.toString())
  }, [saveNow])

  const triggerImmediateSaveRef = useRef(triggerImmediateSave)
  triggerImmediateSaveRef.current = triggerImmediateSave

  const scheduleHoverClose = useCallback(() => {
    if (hoverCloseTimerRef.current) clearTimeout(hoverCloseTimerRef.current)
    hoverCloseTimerRef.current = setTimeout(() => {
      if (!cardHoveredRef.current) {
        setHoveredTarget(null)
      }
    }, HOVER_CLOSE_DELAY)
  }, [])

  const handleGutterHover = useCallback((payload: GutterHoverPayload | null) => {
    if (payload) {
      if (hoverCloseTimerRef.current) {
        clearTimeout(hoverCloseTimerRef.current)
        hoverCloseTimerRef.current = null
      }
      setHoveredTarget((prev) =>
        prev?.change.id === payload.change.id && prev.anchorRect.top === payload.anchorRect.top
          ? prev
          : payload,
      )
    } else {
      scheduleHoverClose()
    }
  }, [scheduleHoverClose])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const initialDoc = latestTextRef.current
    const shikiCompartment = shikiCompartmentRef.current
    const vimCompartment = vimCompartmentRef.current
    const lineNumbersController = createLineNumbersController(
      useAppStore.getState().editorRelativeLineNumbers,
    )
    lineNumbersControllerRef.current = lineNumbersController
    vimActiveRef.current = false

    const syncOverflow = (targetView: EditorView) => {
      const next = targetView.scrollDOM.scrollHeight - targetView.scrollDOM.clientHeight > 1
      if (next) targetView.dom.dataset.hasMinimap = 'true'
      else delete targetView.dom.dataset.hasMinimap
      setOverflowsPage((prev) => (prev === next ? prev : next))
    }

    const state = EditorState.create({
      doc: initialDoc,
      extensions: [
        lineNumbersController.extension,
        createDiffGutterExtensions(handleGutterHover),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        flashLineField,
        codeEditorTheme,
        shikiCompartment.of(createShikiExtension(inferLanguage(filePath), isDark)),
        Prec.high(
          keymap.of([
            {
              key: 'Mod-s',
              run: (targetView) => {
                triggerImmediateSaveRef.current(targetView)
                return true
              },
            },
            {
              key: 'Escape',
              run: () => {
                if (!hoveredTargetRef.current) return false
                setHoveredTarget(null)
                return true
              },
            },
          ]),
        ),
        vimCompartment.of([]),
        keymap.of([
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((vu) => {
          if (vu.docChanged || vu.geometryChanged) {
            syncOverflow(vu.view)
          }
          if (!vu.docChanged) return
          const next = vu.state.doc.toString()
          latestTextRef.current = next
          emittedTextRef.current = next
          setLiveText(next)
          const dirty = next !== savedContentRef.current
          setIsDirty(dirty)
          onDirtyChangeRef.current?.(dirty)
          onContentChangeRef.current?.(next)
          if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current)
            saveTimerRef.current = null
          }
          if (dirty) {
            saveTimerRef.current = setTimeout(() => {
              saveTimerRef.current = null
              void saveNow(next)
            }, AUTOSAVE_DELAY)
          }
        }),
      ],
    })

    const view = new EditorView({ state, parent: host })
    viewRef.current = view
    scrollerRef.current = view.scrollDOM as HTMLDivElement
    setEditorDom(view.dom)
    syncOverflow(view)
    if (diffChanges.length > 0) {
      view.dispatch({ effects: setDiffChangesEffect.of(diffChanges) })
    }

    let overflowRaf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(overflowRaf)
      overflowRaf = requestAnimationFrame(() => syncOverflow(view))
    })
    ro.observe(view.scrollDOM)
    ro.observe(view.contentDOM)
    const sizer = view.scrollDOM.querySelector('.cm-sizer')
    if (sizer) ro.observe(sizer)

    const detachScroll = attachHorizontalGutterClip(view, () => {
      if (!cardHoveredRef.current) setHoveredTarget(null)
    })

    return () => {
      cancelAnimationFrame(overflowRaf)
      ro.disconnect()
      detachScroll()
      if (hoverCloseTimerRef.current) clearTimeout(hoverCloseTimerRef.current)
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        void saveNow(latestTextRef.current)
      }
      vimActiveRef.current = false
      lineNumbersControllerRef.current = null
      setEditorDom(null)
      view.destroy()
      viewRef.current = null
      scrollerRef.current = null
    }
  }, [filePath])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    lineNumbersControllerRef.current?.setEnabled(view, editorRelativeLineNumbers)
  }, [editorRelativeLineNumbers, filePath])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (!editorVimMode) {
      if (vimActiveRef.current) {
        vimActiveRef.current = false
        view.dispatch({ effects: vimCompartmentRef.current.reconfigure([]) })
      }
      return
    }
    let cancelled = false
    void loadVimExtension({
      onSave: (targetView) => triggerImmediateSaveRef.current(targetView),
      getRelativeLineNumbers: () => useAppStore.getState().editorRelativeLineNumbers,
      setRelativeLineNumbers: (enabled) => {
        void useAppStore.getState().setEditorRelativeLineNumbers(enabled)
      },
    }).then((ext) => {
      if (cancelled || viewRef.current !== view) return
      vimActiveRef.current = true
      view.dispatch({ effects: vimCompartmentRef.current.reconfigure(ext) })
    })
    return () => {
      cancelled = true
    }
  }, [editorVimMode, filePath])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: shikiCompartmentRef.current.reconfigure(createShikiExtension(language, isDark)),
    })
  }, [language, isDark])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: setDiffChangesEffect.of(diffChanges) })
    setHoveredTarget((prev) => {
      if (!prev) return null
      const updated = diffChanges.find((c) => c.id === prev.change.id)
      return updated ? { ...prev, change: updated } : null
    })
  }, [diffChanges])

  useEffect(() => {
    if (savingRef.current) return
    if (content === emittedTextRef.current) return
    const view = viewRef.current
    const currentDoc = view ? view.state.doc.toString() : latestTextRef.current
    if (content === currentDoc) return
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    latestTextRef.current = content
    emittedTextRef.current = content
    setLiveText(content)
    setDebouncedLiveText(content)
    const dirty = content !== savedContentRef.current
    setIsDirty(dirty)
    if (view) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
      })
    }
  }, [content])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !scrollToLine) return
    return scrollViewToLineWithFlash(view, () => viewRef.current, scrollToLine.line)
  }, [scrollToLine])

  const handleRevert = useCallback((change: EditorDiffChange) => {
    const view = viewRef.current
    if (!view) return
    const currentDoc = view.state.doc.toString()
    const reverted = revertDiffChange(currentDoc, change)
    cardHoveredRef.current = false
    setHoveredTarget(null)
    if (reverted === currentDoc) return
    view.dispatch({
      changes: { from: 0, to: currentDoc.length, insert: reverted },
    })
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    void saveNow(reverted)
  }, [saveNow])

  const captureEditorSelection = useCallback(
    () => captureViewSelection(viewRef.current, fullFilePath),
    [fullFilePath],
  )

  return (
    <FileSelectionContextMenuZone
      filePath={fullFilePath}
      fileContent={liveText}
      captureSelection={captureEditorSelection}
      className="size-full"
    >
      <div
        ref={hostRef}
        data-testid="code-file-editor"
        data-dirty={isDirty ? 'true' : 'false'}
        className="size-full overflow-hidden"
      />
      {overflowsPage &&
        editorDom &&
        createPortal(
          <CodeMinimap
            key={filePath}
            lines={minimapLines}
            tokens={minimapTokens}
            scrollRef={scrollerRef}
          />,
          editorDom,
        )}
      {hoveredTarget && (
        <DiffHunkHoverCard
          change={hoveredTarget.change}
          anchorRect={hoveredTarget.anchorRect}
          language={language}
          fileRoot={fileRoot ?? null}
          onRevert={handleRevert}
          onMouseEnter={() => {
            cardHoveredRef.current = true
            if (hoverCloseTimerRef.current) {
              clearTimeout(hoverCloseTimerRef.current)
              hoverCloseTimerRef.current = null
            }
          }}
          onMouseLeave={() => {
            cardHoveredRef.current = false
            scheduleHoverClose()
          }}
        />
      )}
    </FileSelectionContextMenuZone>
  )
}
