import { type Extension, Prec, StateEffect, StateField } from '@codemirror/state'
import { EditorView, type Panel, ViewPlugin, showPanel } from '@codemirror/view'

type VimModule = typeof import('@replit/codemirror-vim')

interface VimModeChangeEvent {
  mode: string
  subMode?: string
}

interface InternalVimAdapter {
  cm6?: EditorView
  on?: (type: 'vim-mode-change', handler: (event: VimModeChangeEvent) => void) => void
  off?: (type: 'vim-mode-change', handler: (event: VimModeChangeEvent) => void) => void
  state?: {
    dialog?: HTMLElement
    overwrite?: boolean
    statusbar?: HTMLElement
    vim?: {
      insertMode?: boolean
      mode?: string
    }
    vimPlugin?: {
      updateStatus: () => void
    }
  }
}

export interface VimCallbacks {
  onSave: (view: EditorView) => void
  getRelativeLineNumbers: () => boolean
  setRelativeLineNumbers: (enabled: boolean) => void
}

const vimCallbacksMap = new WeakMap<EditorView, VimCallbacks>()
const setVimEditableEffect = StateEffect.define<boolean>()
let vimModulePromise: Promise<VimModule> | null = null
let vimHooksInstalled = false
let fallbackRelativeLineNumbers = false

const vimEditableField = StateField.define<boolean>({
  create() {
    return false
  },
  update(value, tr) {
    let next = value
    for (const effect of tr.effects) {
      if (effect.is(setVimEditableEffect)) {
        next = effect.value
      }
    }
    return next
  },
  provide(field) {
    return [
      EditorView.editable.from(field),
      EditorView.contentAttributes.of({ tabindex: '0' }),
    ]
  },
})

const vimEditorTheme = EditorView.theme({
  '.cm-vim-panel': {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minHeight: '26px',
    padding: '2px 12px',
    fontSize: '12px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    color: 'var(--muted-foreground)',
    backgroundColor: 'transparent',
  },
  '.cm-vim-panel > span:first-child': {
    color: 'var(--foreground)',
    fontWeight: '500',
    letterSpacing: '0.02em',
  },
  '.cm-vim-panel > div': {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flex: '1',
    minWidth: '0',
    color: 'var(--foreground)',
  },
  '.cm-vim-panel input, .cm-vim-panel input:focus, .cm-vim-panel input:focus-visible': {
    border: 'none',
    outline: 'none !important',
    boxShadow: 'none !important',
    backgroundColor: 'transparent',
    color: 'var(--foreground)',
    caretColor: 'var(--foreground)',
    fontFamily: 'inherit',
    fontSize: '12px',
    flex: '1',
    minWidth: '0',
    padding: '0',
  },
})

const vimCursorTheme = Prec.highest(
  EditorView.theme({
    '&.cm-editor .cm-fat-cursor': {
      background: 'color-mix(in oklch, var(--foreground) 78%, transparent)',
      color: 'var(--background) !important',
      borderRadius: '1px',
    },
    '&.cm-editor:not(.cm-focused) .cm-fat-cursor': {
      background: 'transparent',
      outline: '1px solid color-mix(in oklch, var(--foreground) 50%, transparent)',
      color: 'transparent !important',
    },
  }),
)

function getVimModule(): Promise<VimModule> {
  if (!vimModulePromise) {
    vimModulePromise = import('@replit/codemirror-vim').then((mod) => {
      if (!vimHooksInstalled) {
        vimHooksInstalled = true
        mod.CodeMirror.commands.save = (cm: unknown) => {
          const view = (cm as InternalVimAdapter).cm6
          if (view) vimCallbacksMap.get(view)?.onSave(view)
        }
        mod.Vim.defineOption(
          'relativenumber',
          false,
          'boolean',
          ['rnu'],
          (value, cm) => {
            const view = (cm as InternalVimAdapter | undefined)?.cm6
            const callbacks = view ? vimCallbacksMap.get(view) : undefined
            if (value === undefined) {
              return callbacks ? callbacks.getRelativeLineNumbers() : fallbackRelativeLineNumbers
            }
            const enabled = Boolean(value)
            fallbackRelativeLineNumbers = enabled
            callbacks?.setRelativeLineNumbers(enabled)
            return undefined
          },
        )
      }
      return mod
    })
  }
  return vimModulePromise
}

interface InternalEditorViewInputState {
  inputState?: {
    compositionPendingKey?: boolean
  }
}

function clearCmCompositionPendingKey(view: EditorView): void {
  const internal = view as unknown as InternalEditorViewInputState
  if (internal.inputState) {
    internal.inputState.compositionPendingKey = false
  }
}

function attachImeKeyGuard(
  root: HTMLElement,
  options?: { inputOnly?: boolean; onClearPendingKey?: () => void },
): () => void {
  let composing = false
  let sawKeyDownBeforeEnd = false
  let pendingPostCompositionKey = false
  let lastCompositionEndAt = 0

  const matchesTarget = (target: EventTarget | null): boolean =>
    !options?.inputOnly || target instanceof HTMLInputElement

  const onFocusIn = (event: FocusEvent) => {
    if (!options?.inputOnly || !(event.target instanceof HTMLInputElement)) return
    event.target.spellcheck = false
    event.target.autocapitalize = 'off'
    event.target.autocomplete = 'off'
    event.target.setAttribute('autocorrect', 'off')
  }

  const onCompositionStart = (event: CompositionEvent) => {
    if (!matchesTarget(event.target)) return
    composing = true
    sawKeyDownBeforeEnd = false
    pendingPostCompositionKey = false
  }

  const onCompositionUpdate = (event: CompositionEvent) => {
    if (!matchesTarget(event.target)) return
    composing = true
    sawKeyDownBeforeEnd = false
  }

  const onCompositionEndCapture = (event: CompositionEvent) => {
    if (!matchesTarget(event.target)) return
    composing = false
    pendingPostCompositionKey = !sawKeyDownBeforeEnd
    sawKeyDownBeforeEnd = false
    lastCompositionEndAt = performance.now()
  }

  const onCompositionEndBubble = (event: CompositionEvent) => {
    if (!matchesTarget(event.target)) return
    if (!pendingPostCompositionKey) {
      options?.onClearPendingKey?.()
    }
  }

  const onKeyUp = (event: KeyboardEvent) => {
    if (!matchesTarget(event.target)) return
    if (pendingPostCompositionKey) {
      pendingPostCompositionKey = false
      options?.onClearPendingKey?.()
    }
  }

  const onFocusOut = (event: FocusEvent) => {
    if (!matchesTarget(event.target)) return
    composing = false
    sawKeyDownBeforeEnd = false
    pendingPostCompositionKey = false
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!matchesTarget(event.target)) return
    const activeComposition =
      composing ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.key === 'Process'
    if (activeComposition) {
      sawKeyDownBeforeEnd = true
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }
    if (
      pendingPostCompositionKey &&
      (event.key === 'Enter' || event.key === 'Escape') &&
      performance.now() - lastCompositionEndAt < 60
    ) {
      pendingPostCompositionKey = false
      options?.onClearPendingKey?.()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
  }

  root.addEventListener('focusin', onFocusIn, true)
  root.addEventListener('compositionstart', onCompositionStart, true)
  root.addEventListener('compositionupdate', onCompositionUpdate, true)
  root.addEventListener('compositionend', onCompositionEndCapture, true)
  root.addEventListener('compositionend', onCompositionEndBubble, false)
  root.addEventListener('keyup', onKeyUp, true)
  root.addEventListener('focusout', onFocusOut, true)
  root.addEventListener('keydown', onKeyDown, true)

  return () => {
    root.removeEventListener('focusin', onFocusIn, true)
    root.removeEventListener('compositionstart', onCompositionStart, true)
    root.removeEventListener('compositionupdate', onCompositionUpdate, true)
    root.removeEventListener('compositionend', onCompositionEndCapture, true)
    root.removeEventListener('compositionend', onCompositionEndBubble, false)
    root.removeEventListener('keyup', onKeyUp, true)
    root.removeEventListener('focusout', onFocusOut, true)
    root.removeEventListener('keydown', onKeyDown, true)
  }
}

function isEditableVimMode(cm: InternalVimAdapter | null, mode?: string): boolean {
  if (mode) {
    return mode === 'insert' || mode === 'replace'
  }
  return Boolean(cm?.state?.vim?.insertMode || cm?.state?.overwrite)
}

function syncVimEditable(
  view: EditorView,
  cm: InternalVimAdapter | null,
  nextEditable: boolean,
): void {
  const current = view.state.field(vimEditableField, false)
  if (current === undefined || current === nextEditable) return

  const apply = () => {
    if (view.state.field(vimEditableField, false) !== nextEditable) {
      const ownerDoc = view.contentDOM.ownerDocument
      const wasContentFocused = ownerDoc.activeElement === view.contentDOM
      view.dispatch({ effects: setVimEditableEffect.of(nextEditable) })
      if (wasContentFocused && !cm?.state?.dialog) {
        if (ownerDoc.activeElement !== view.contentDOM) {
          view.contentDOM.focus({ preventScroll: true })
        }
        if (nextEditable) {
          const sel = ownerDoc.getSelection()
          if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0).cloneRange()
            sel.removeAllRanges()
            sel.addRange(range)
          }
        }
      }
    }
  }

  try {
    apply()
  } catch {
    queueMicrotask(apply)
  }
}

function bindVimStatusBar(
  view: EditorView,
  dom: HTMLElement,
  getCM: VimModule['getCM'],
): void {
  const cm = getCM(view) as unknown as InternalVimAdapter | null
  if (!cm?.state || cm.state.statusbar === dom) return
  cm.state.statusbar = dom
  cm.state.vimPlugin?.updateStatus()
}

export async function loadVimExtension(callbacks: VimCallbacks): Promise<Extension> {
  const { vim, getCM } = await getVimModule()
  const vimBridgePlugin = ViewPlugin.define((view) => {
    vimCallbacksMap.set(view, callbacks)
    const detachContentImeGuard = attachImeKeyGuard(view.contentDOM, {
      onClearPendingKey: () => clearCmCompositionPendingKey(view),
    })
    const panelDom = view.dom.querySelector('.cm-vim-panel') as HTMLElement | null
    if (panelDom) bindVimStatusBar(view, panelDom, getCM)

    let boundCm: InternalVimAdapter | null = null
    const onModeChange = (event: VimModeChangeEvent) => {
      syncVimEditable(view, boundCm, isEditableVimMode(boundCm, event.mode))
    }

    const ensureModeSubscription = () => {
      const cm = getCM(view) as unknown as InternalVimAdapter | null
      if (!cm || cm === boundCm) return
      boundCm?.off?.('vim-mode-change', onModeChange)
      boundCm = cm
      cm.on?.('vim-mode-change', onModeChange)
      if (isEditableVimMode(cm) !== view.state.field(vimEditableField, false)) {
        queueMicrotask(() => {
          if (boundCm === cm) {
            syncVimEditable(view, cm, isEditableVimMode(cm))
          }
        })
      }
    }

    ensureModeSubscription()

    return {
      update() {
        ensureModeSubscription()
      },
      destroy() {
        boundCm?.off?.('vim-mode-change', onModeChange)
        boundCm = null
        detachContentImeGuard()
        vimCallbacksMap.delete(view)
      },
    }
  })

  const statusBarPanel = showPanel.of((view): Panel => {
    const dom = document.createElement('div')
    dom.className = 'cm-vim-panel'
    const detachPanelImeGuard = attachImeKeyGuard(dom, { inputOnly: true })
    bindVimStatusBar(view, dom, getCM)
    return {
      dom,
      mount() {
        bindVimStatusBar(view, dom, getCM)
      },
      update() {
        bindVimStatusBar(view, dom, getCM)
      },
      destroy() {
        detachPanelImeGuard()
        const cm = getCM(view) as unknown as InternalVimAdapter | null
        if (cm?.state?.statusbar === dom) {
          delete cm.state.statusbar
        }
      },
    }
  })

  return [vimEditableField, vim(), statusBarPanel, vimBridgePlugin, vimEditorTheme, vimCursorTheme]
}
