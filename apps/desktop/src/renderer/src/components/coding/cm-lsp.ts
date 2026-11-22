import { Prec, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view'
import { LSPPlugin, jumpToDefinition } from '@codemirror/lsp-client'
import type { BundledLanguage } from 'shiki'
import {
  disposeLspClient,
  getOrCreateLspClientEntry,
  pathToFileUri,
  resolveEnabledLspServer,
} from '@/lib/lsp-client-service'
import { getFileHighlighter, getFileHighlighterSync, getShikiTarget } from '@/lib/shiki-highlighter'

export { disposeLspClient }

function extractCodeBlockLanguage(codeEl: HTMLElement, fallback: string): string {
  for (const cls of Array.from(codeEl.classList)) {
    if (cls.startsWith('language-')) {
      return cls.slice('language-'.length) || fallback
    }
  }
  return fallback
}

async function highlightCodeElement(codeEl: HTMLElement, isDark: boolean, fallbackLang: string): Promise<void> {
  if (codeEl.dataset.shikiHighlighted === 'true') return
  const source = codeEl.textContent ?? ''
  if (!source.trim()) return

  const lang = extractCodeBlockLanguage(codeEl, fallbackLang)
  const target = getShikiTarget(isDark, lang)
  const hl =
    getFileHighlighterSync(target.theme, target.lang) ??
    (await getFileHighlighter(target.theme, target.lang))
  if (!codeEl.isConnected) return

  const { tokens } = hl.codeToTokens(source, {
    lang: target.lang as BundledLanguage,
    theme: target.theme,
  })
  const fragment = document.createDocumentFragment()
  tokens.forEach((line, lineIdx) => {
    if (lineIdx > 0) fragment.appendChild(document.createTextNode('\n'))
    for (const token of line) {
      const span = document.createElement('span')
      span.textContent = token.content
      if (token.color) span.style.color = token.color
      fragment.appendChild(span)
    }
  })
  codeEl.replaceChildren(fragment)
  codeEl.dataset.shikiHighlighted = 'true'
}

function createLspTooltipHighlightExtension(isDark: boolean, fallbackLang: string): Extension {
  return ViewPlugin.fromClass(
    class {
      private rootObserver: MutationObserver
      private tooltipObservers = new Map<HTMLElement, MutationObserver>()

      constructor(view: EditorView) {
        const scanRoot = (root: ParentNode) => {
          const blocks = root.querySelectorAll<HTMLElement>('.cm-lsp-documentation pre code')
          for (const block of blocks) {
            if (block.dataset.shikiHighlighted !== 'true') {
              void highlightCodeElement(block, isDark, fallbackLang)
            }
          }
        }

        const watchTooltip = (el: HTMLElement) => {
          if (this.tooltipObservers.has(el)) return
          scanRoot(el)
          const sub = new MutationObserver(() => scanRoot(el))
          sub.observe(el, { childList: true, subtree: true })
          this.tooltipObservers.set(el, sub)
        }

        const unwatchTooltip = (el: HTMLElement) => {
          const sub = this.tooltipObservers.get(el)
          if (!sub) return
          sub.disconnect()
          this.tooltipObservers.delete(el)
        }

        this.rootObserver = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (node instanceof HTMLElement && node.classList.contains('cm-tooltip')) {
                watchTooltip(node)
              }
            }
            for (const node of mutation.removedNodes) {
              if (node instanceof HTMLElement && node.classList.contains('cm-tooltip')) {
                unwatchTooltip(node)
              }
            }
          }
        })

        this.rootObserver.observe(view.dom, { childList: true, subtree: false })
        for (const child of Array.from(view.dom.children)) {
          if (child instanceof HTMLElement && child.classList.contains('cm-tooltip')) {
            watchTooltip(child)
          }
        }
      }

      destroy() {
        this.rootObserver.disconnect()
        for (const sub of this.tooltipObservers.values()) {
          sub.disconnect()
        }
        this.tooltipObservers.clear()
      }
    },
  )
}

const setJumpLinkEffect = StateEffect.define<{ from: number; to: number } | null>()

const jumpLinkMark = Decoration.mark({ class: 'cm-lsp-jump-link' })

const jumpLinkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decos, tr) {
    if (tr.docChanged) return Decoration.none
    for (const effect of tr.effects) {
      if (effect.is(setJumpLinkEffect)) {
        return effect.value ? Decoration.set([jumpLinkMark.range(effect.value.from, effect.value.to)]) : Decoration.none
      }
    }
    return decos
  },
  provide: (f) => EditorView.decorations.from(f),
})

function isMacPlatform(): boolean {
  return navigator.platform.includes('Mac')
}

function isJumpModifierActive(event: MouseEvent | KeyboardEvent): boolean {
  return isMacPlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

function createCmdHoverUnderlineExtension(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      private lastCoords: { x: number; y: number } | null = null
      private lastWordKey: string | null = null
      private requestSeq = 0
      private modifierDown = false

      constructor(private readonly view: EditorView) {
        window.addEventListener('keydown', this.onKeyDown)
        window.addEventListener('keyup', this.onKeyUp)
        window.addEventListener('blur', this.onBlur)
        this.view.dom.addEventListener('mousemove', this.onMouseMove)
        this.view.dom.addEventListener('mouseleave', this.onMouseLeave)
      }

      private clearUnderline() {
        this.lastWordKey = null
        this.requestSeq += 1
        if (this.view.state.field(jumpLinkField).size > 0) {
          this.view.dispatch({ effects: setJumpLinkEffect.of(null) })
        }
      }

      private async checkAtCoords(coords: { x: number; y: number }) {
        const pos = this.view.posAtCoords(coords)
        if (pos == null) {
          this.clearUnderline()
          return
        }
        const word = this.view.state.wordAt(pos)
        if (!word || word.from === word.to) {
          this.clearUnderline()
          return
        }
        const wordKey = `${word.from}:${word.to}`
        if (wordKey === this.lastWordKey) return
        this.lastWordKey = wordKey

        const lspPlugin = LSPPlugin.get(this.view)
        if (!lspPlugin || lspPlugin.client.serverCapabilities?.definitionProvider === false) {
          this.clearUnderline()
          return
        }

        const seq = ++this.requestSeq
        try {
          const result = await lspPlugin.client.request('textDocument/definition', {
            textDocument: { uri: lspPlugin.uri },
            position: lspPlugin.toPosition(pos),
          })
          if (seq !== this.requestSeq || !this.modifierDown) return
          const hasTarget = Array.isArray(result) ? result.length > 0 : Boolean(result)
          this.view.dispatch({
            effects: setJumpLinkEffect.of(hasTarget ? { from: word.from, to: word.to } : null),
          })
        } catch {
          if (seq === this.requestSeq) {
            this.view.dispatch({ effects: setJumpLinkEffect.of(null) })
          }
        }
      }

      private onMouseMove = (event: MouseEvent) => {
        this.lastCoords = { x: event.clientX, y: event.clientY }
        this.modifierDown = isJumpModifierActive(event)
        if (!this.modifierDown) {
          this.clearUnderline()
          return
        }
        void this.checkAtCoords(this.lastCoords)
      }

      private onMouseLeave = () => {
        this.lastCoords = null
        this.clearUnderline()
      }

      private onKeyDown = (event: KeyboardEvent) => {
        const active = isJumpModifierActive(event)
        if (active && !this.modifierDown) {
          this.modifierDown = true
          if (this.lastCoords) {
            void this.checkAtCoords(this.lastCoords)
          }
        } else if (!active && this.modifierDown) {
          this.modifierDown = false
          this.clearUnderline()
        }
      }

      private onKeyUp = (event: KeyboardEvent) => {
        if (!isJumpModifierActive(event)) {
          this.modifierDown = false
          this.clearUnderline()
        }
      }

      private onBlur = () => {
        this.modifierDown = false
        this.clearUnderline()
      }

      destroy() {
        window.removeEventListener('keydown', this.onKeyDown)
        window.removeEventListener('keyup', this.onKeyUp)
        window.removeEventListener('blur', this.onBlur)
        this.view.dom.removeEventListener('mousemove', this.onMouseMove)
        this.view.dom.removeEventListener('mouseleave', this.onMouseLeave)
      }
    },
  )
  return [jumpLinkField, plugin]
}

function createCmdClickJumpExtension(): Extension {
  return Prec.highest(
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!isJumpModifierActive(event) || event.button !== 0) return false
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos == null) return false
        event.preventDefault()
        view.dispatch({ selection: { anchor: pos } })
        jumpToDefinition(view)
        return true
      },
    }),
  )
}

export interface LoadLspExtensionOptions {
  workspaceRoot: string
  filePath: string
  language: string | null | undefined
  isDark?: boolean
}

export async function loadLspExtension(options: LoadLspExtensionOptions): Promise<Extension> {
  const target = await resolveEnabledLspServer(options.filePath, options.language)
  if (!target) return []
  const { client } = getOrCreateLspClientEntry(target.serverId, options.workspaceRoot)
  return [
    client.plugin(pathToFileUri(options.filePath), target.languageId),
    createCmdClickJumpExtension(),
    createCmdHoverUnderlineExtension(),
    createLspTooltipHighlightExtension(options.isDark ?? true, options.language ?? 'typescript'),
  ]
}
