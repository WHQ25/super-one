import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Tabs, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import { ModSurfaceFrame, pressModHotkey, useModUi, useModUiState, windowViewport } from '@superone/chat-view/mod-ui'
import { MOD_ABOVE_PROMPT_INSTANCE, type ModPane } from '@superone/shared/mod-ui'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useChatStore } from '@/stores/chat'
import { cn } from '@superone/ui/lib/utils'
import { closeModPaneTab, isModPaneTabOpen, listModPaneTabs, openModPaneTab } from '@/components/activity/activity-panel-api'

/** Rows a band may take before it scrolls (the terminal's own cap is similar). */
const BAND_MAX_ROWS = 8
/** How long Ctrl+X waits for its Tab, like the terminal's chord. */
const CHORD_MS = 1000

const PANE = '[data-mod-site="Pane"]'

function isComposer(el: EventTarget | null): el is HTMLElement {
  return el instanceof HTMLElement && el.closest('[data-chat-input-editor]') !== null
}

/** A dock tab's pane, marked with its session and pane id by the dock panel. */
function dockPaneSelector(sessionId: string, paneId?: string): string {
  return `[data-mod-pane-session="${CSS.escape(sessionId)}"]${paneId ? `[data-mod-pane-id="${CSS.escape(paneId)}"]` : ''} ${PANE}`
}

/** The pane this composer's Ctrl+X Tab moves into: inline above it, else its session's dock tab. */
function composerPane(root: HTMLElement, sessionId: string | null): HTMLElement | null {
  return root.querySelector<HTMLElement>(PANE) ?? (sessionId ? document.querySelector<HTMLElement>(dockPaneSelector(sessionId)) : null)
}

/** Whether `el` sits in one of this composer's panes (not another tile's). */
function inComposerPane(el: EventTarget | null, root: HTMLElement, sessionId: string | null): boolean {
  const pane = el instanceof HTMLElement ? el.closest(PANE) : null
  if (!pane) return false
  return root.contains(pane) || (!!sessionId && pane.closest(`[data-mod-pane-session="${CSS.escape(sessionId)}"]`) !== null)
}

function hasTextSelection(el: EventTarget | null): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.selectionStart !== el.selectionEnd
  const selection = window.getSelection()
  return !!selection && !selection.isCollapsed
}

function consume(e: KeyboardEvent): void {
  e.preventDefault()
  // Capturing on window: nothing after this (the question form's digits, the
  // editor's Tab) sees a key a mod took.
  e.stopPropagation()
}

interface ComposerKeysScope {
  /** The composer's root element. */
  root: () => HTMLElement | null | undefined
  sessionId: string | null
  /** Whether the draft is empty (a prompt suggestion's ghost text does not count). */
  isEmpty: () => boolean
  returnKeyboard: () => void
}

/**
 * The composer's keys for mods, scoped to one composer: from an empty composer
 * a digit presses the band button with that hotkey, and Ctrl+X Tab moves the
 * keyboard into the shown pane (and from a pane, back). Ctrl+X is taken only
 * when there is a pane to move to, and off macOS never over a selection, where
 * it is Cut.
 */
function useModComposerKeys({ root, sessionId, isEmpty, returnKeyboard }: ComposerKeysScope) {
  useEffect(() => {
    let chordAt = 0
    const onKeyDown = (e: KeyboardEvent) => {
      const el = root()
      if (!el || e.isComposing) return
      const inComposer = isComposer(e.target) && el.contains(e.target as Node)
      const inPane = !inComposer && inComposerPane(e.target, el, sessionId)
      if (!inComposer && !inPane) return
      if (e.key === 'x' && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        chordAt = 0
        if (window.app.platform !== 'darwin' && hasTextSelection(e.target)) return
        if (inComposer && !composerPane(el, sessionId)) return
        chordAt = Date.now()
        consume(e)
        return
      }
      if (e.key === 'Tab' && Date.now() - chordAt < CHORD_MS) {
        chordAt = 0
        consume(e)
        if (inPane) return returnKeyboard()
        const pane = composerPane(el, sessionId)
        ;(pane?.querySelector<HTMLElement>('[data-mod-control]') ?? pane)?.focus()
        return
      }
      chordAt = 0
      if (!inComposer || e.metaKey || e.ctrlKey || e.altKey || !/^[0-9]$/.test(e.key) || !isEmpty()) return
      const button = [...el.querySelectorAll<HTMLElement>(`[data-mod-site="AbovePrompt"] [data-mod-control][data-mod-hotkey="${e.key}"]`)].at(-1)
      if (!button) return
      consume(e)
      pressModHotkey(button)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [root, sessionId, isEmpty, returnKeyboard])
}

function useReturnKeyboard() {
  return useCallback(() => useChatStore.getState().requestChatInputFocusRestore(), [])
}

/**
 * One pane's body, wherever it sits: a dock tab beside the transcript
 * (`dock`) or the framed region above the composer (`inline`).
 */
export function ModPaneBody({ paneId, placement, className, style, focusOnMount }: { paneId: string; placement: 'dock' | 'inline'; className?: string; style?: CSSProperties; focusOnMount?: boolean }) {
  const { t } = useTranslation()
  const ctx = useModUi()
  const { roster } = useModUiState()
  const returnKeyboard = useReturnKeyboard()
  const pane = roster.panes.find((p) => p.id === paneId)
  const props = useMemo(() => ({ title: pane?.title ?? paneId, placement, view: {} }), [pane?.title, paneId, placement])
  if (!ctx || !pane) {
    return <div className="p-4 text-xs text-muted-foreground">{t('chat.mods.paneClosed')}</div>
  }
  const onEscape = () => {
    if (pane.closeOnEscape) void ctx.client.act('close', { id: pane.id, clientId: ctx.client.clientId })
    else {
      void ctx.client.act('paneFocus', { id: null, surface: ctx.client.surface, clientId: ctx.client.clientId })
      returnKeyboard()
    }
  }
  return (
    <ModSurfaceFrame
      component="Pane"
      instanceId={pane.id}
      plugin={pane.plugin}
      props={props}
      viewport={windowViewport(true)}
      onEscape={onEscape}
      focusOnMount={focusOnMount}
      className={className}
      style={style}
    />
  )
}

/**
 * Panes shown above the composer while the activity dock is hidden: one
 * framed region, tabs when several, at most a third of the window tall.
 */
export function ModInlinePanes({ panes, shownId }: { panes: ModPane[]; shownId: string | null }) {
  const { t } = useTranslation()
  const ctx = useModUi()
  const shown = panes.find((p) => p.id === shownId) ?? panes.at(-1)
  if (!ctx || !shown) return null
  const rows = shown.rows ?? 12
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-background/60">
      <div className="flex h-8 items-center gap-1 border-b border-border/60 px-2">
        {panes.length > 1 ? (
          <Tabs value={shown.id} onValueChange={(id) => void ctx.client.act('paneShow', { id, surface: ctx.client.surface, clientId: ctx.client.clientId })}>
            <TabsList className="h-6">
              {panes.map((p) => (
                <TabsTrigger key={p.id} value={p.id} className="h-5 px-2 text-xs">{p.title}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : (
          <span className="truncate text-xs font-medium">{shown.title}</span>
        )}
        <span className="ml-auto truncate text-2xs text-muted-foreground">{shown.plugin}</span>
        <IconButton
          size="xs"
          aria-label={t('chat.mods.closePane')}
          onClick={() => void ctx.client.act('close', { id: shown.id, clientId: ctx.client.clientId })}
        >
          <X />
        </IconButton>
      </div>
      <ModPaneBody
        key={shown.id}
        paneId={shown.id}
        placement="inline"
        className="px-3 py-2"
        // `rows` is the pane's own ask, capped at a third of the window.
        style={{ maxHeight: `min(calc(${rows} * var(--mod-row, 18px) + 1rem), 33vh)` }}
        focusOnMount={false}
      />
    </div>
  )
}

/**
 * Everything a mod draws above the composer: inline panes (when the dock is
 * hidden) and the band every mod shares. Collapses to nothing when no mod
 * draws there.
 */
export function ModAbovePrompt({ isWorking, sessionId, isComposerEmpty }: { isWorking: boolean; sessionId: string | null; isComposerEmpty: () => boolean }) {
  const ctx = useModUi()
  const { available, roster } = useModUiState()
  const dockShown = useActivityPanelStore((s) => s.showPanel)
  const [drawn, setDrawn] = useState(false)
  const returnKeyboard = useReturnKeyboard()
  const wrapper = useRef<HTMLDivElement>(null)
  const composerRoot = useCallback(() => wrapper.current?.parentElement, [])
  useModComposerKeys({ root: composerRoot, sessionId, isEmpty: isComposerEmpty, returnKeyboard })
  const props = useMemo(() => ({ hasSurvey: false, isWorking, maxRows: BAND_MAX_ROWS, view: {} }), [isWorking])
  if (!ctx || !available) return null
  const inline = !dockShown && roster.panes.length > 0
  return (
    <div ref={wrapper} className={cn('mx-3 flex flex-col gap-1', (drawn || inline) && 'mb-1')}>
      {inline ? <ModInlinePanes panes={roster.panes} shownId={roster.shownId} /> : null}
      <ModSurfaceFrame
        component="AbovePrompt"
        instanceId={MOD_ABOVE_PROMPT_INSTANCE}
        props={props}
        viewport={windowViewport(true)}
        onDrawn={setDrawn}
        onEscape={returnKeyboard}
        className={drawn ? 'max-h-[calc(8*var(--mod-row,18px))] rounded-lg px-1' : 'max-h-0 overflow-hidden'}
      />
    </div>
  )
}

/**
 * Keeps the activity dock's mod tabs in step with the foreground session's
 * pane roster: a tab per placed pane, the shown one active, gone when the
 * pane closes. A pane opened with `focus` brings the dock up; others join it
 * only while it is visible (otherwise they draw inline above the composer).
 */
export function ModPaneDockSync({ projectPath, sessionId }: { projectPath: string; sessionId: string }) {
  const ctx = useModUi()
  const { available, roster } = useModUiState()
  const dockShown = useActivityPanelStore((s) => s.showPanel)
  const draft = useChatStore((s) => s.projectSessions[projectPath]?._sessions[sessionId]?.draftText ?? '')
  const idle = useChatStore((s) => s.projectSessions[projectPath]?._sessions[sessionId]?.status === 'idle')
  const judged = useRef<{ sessionId: string; paneId: string } | null>(null)

  useEffect(() => {
    // No client (mods turned off) closes every tab, as an unavailable session does.
    const panes = ctx && available ? roster.panes : []
    const live = new Set(panes.map((p) => p.id))
    for (const id of listModPaneTabs(sessionId)) if (!live.has(id)) closeModPaneTab(sessionId, id)
    for (const pane of panes) {
      const wantsFocus = roster.focusRequestedId === pane.id
      if (!dockShown && !wantsFocus && !isModPaneTabOpen(sessionId, pane.id)) continue
      openModPaneTab({ projectPath, sessionId, paneId: pane.id, title: pane.title, activate: pane.id === roster.shownId, reveal: wantsFocus })
    }
  }, [ctx, available, roster, dockShown, projectPath, sessionId])

  // A standing `$.ui.open({ focus: true })` is ours to judge: honoured only while
  // the composer is empty and idle, so a pane never steals someone's typing.
  useEffect(() => {
    const requested = roster.focusRequestedId
    if (!ctx || !requested) return
    if (judged.current?.sessionId === sessionId && judged.current.paneId === requested) return
    judged.current = { sessionId, paneId: requested }
    const honour = draft.length === 0 && idle
    void ctx.client.act('paneFocus', { id: honour ? requested : null, surface: ctx.client.surface, clientId: ctx.client.clientId })
    if (honour) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`${dockPaneSelector(sessionId, requested)} [data-mod-control]`)?.focus())
    }
  }, [ctx, roster.focusRequestedId, draft, idle, sessionId])

  return null
}
