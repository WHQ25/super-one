import { Prec, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  EditorView,
  ViewPlugin,
  activateHover,
  closeHoverTooltip,
  closeHoverTooltips,
  hasHoverTooltips,
  hoverTooltip,
  keymap,
  Decoration,
  type DecorationSet,
} from '@codemirror/view'
import { LSPPlugin } from '@codemirror/lsp-client'
import type { BundledLanguage } from 'shiki'
import {
  disposeLspClient,
  getOrCreateLspClientEntry,
  pathToFileUri,
  pickBestDefinitionLocation,
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

function isHoverModifierActive(event: MouseEvent | KeyboardEvent): boolean {
  return event.altKey && !event.ctrlKey && !event.metaKey
}

const altHoverActiveViews = new WeakSet<EditorView>()

function renderLspHoverItem(plugin: LSPPlugin, item: unknown): string {
  if (typeof item === 'string') {
    return plugin.docToHTML(item, 'markdown')
  }
  if (item && typeof item === 'object') {
    const obj = item as { language?: string; value?: string; kind?: 'plaintext' | 'markdown' }
    if (typeof obj.language === 'string' && typeof obj.value === 'string') {
      return plugin.docToHTML(`\`\`\`${obj.language}\n${obj.value}\n\`\`\``, 'markdown')
    }
    if (typeof obj.value === 'string') {
      return plugin.docToHTML({ kind: obj.kind ?? 'markdown', value: obj.value })
    }
  }
  return ''
}

function renderLspHoverContents(plugin: LSPPlugin, contents: unknown): string {
  if (!contents) return ''
  if (Array.isArray(contents)) {
    return contents.map((item) => renderLspHoverItem(plugin, item)).filter(Boolean).join('<br>')
  }
  return renderLspHoverItem(plugin, contents)
}

export function createAltHoverTooltipExtension(): Extension {
  const tooltipExt = hoverTooltip(
    async (view, pos) => {
      if (!altHoverActiveViews.has(view)) return null
      const plugin = LSPPlugin.get(view)
      if (!plugin || plugin.client.serverCapabilities?.hoverProvider === false) return null
      plugin.client.sync()
      const result = (await plugin.client
        .request('textDocument/hover', {
          textDocument: { uri: plugin.uri },
          position: plugin.toPosition(pos),
        })
        .catch(() => null)) as {
        contents?: unknown
        range?: { start: { line: number; character: number }; end: { line: number; character: number } }
      } | null
      if (!result) return null
      const html = renderLspHoverContents(plugin, result.contents).trim()
      if (!html) return null
      return {
        pos: result.range ? plugin.fromPosition(result.range.start) : pos,
        end: result.range ? plugin.fromPosition(result.range.end) : pos,
        create() {
          const elt = document.createElement('div')
          elt.className = 'cm-lsp-hover-tooltip cm-lsp-documentation'
          elt.innerHTML = html
          return { dom: elt }
        },
        above: true,
      }
    },
    { hideOn: (tr) => tr.docChanged },
  )

  const controller = ViewPlugin.fromClass(
    class {
      private lastCoords: { x: number; y: number } | null = null
      private activatedByAlt = false

      constructor(private readonly view: EditorView) {
        window.addEventListener('keydown', this.onKeyDown)
        window.addEventListener('keyup', this.onKeyUp)
        window.addEventListener('blur', this.onBlur)
        this.view.dom.addEventListener('mousemove', this.onMouseMove)
        this.view.dom.addEventListener('mouseleave', this.onMouseLeave)
      }

      private setAltActive(active: boolean) {
        if (active) altHoverActiveViews.add(this.view)
        else altHoverActiveViews.delete(this.view)
      }

      private dismissAltActivated() {
        if (!this.activatedByAlt) return
        this.activatedByAlt = false
        if (hasHoverTooltips(this.view.state)) {
          this.view.dispatch({ effects: closeHoverTooltip(tooltipExt) })
        }
      }

      private isInsideHoverTooltip(target: EventTarget | null): HTMLElement | null {
        if (!(target instanceof Node)) return null
        const el = target instanceof HTMLElement ? target : target.parentElement
        return el?.closest<HTMLElement>('.cm-tooltip-hover') ?? null
      }

      private onMouseMove = (event: MouseEvent) => {
        this.lastCoords = { x: event.clientX, y: event.clientY }
        const altActive = isHoverModifierActive(event)
        this.setAltActive(altActive)
        if (!this.activatedByAlt) return
        if (this.isInsideHoverTooltip(event.target)) return
        const active = this.view.state.field(tooltipExt.active, false)
        if (!active?.length) {
          this.activatedByAlt = false
          return
        }
        const pos = this.view.posAtCoords(this.lastCoords, false)
        const first = active[0]
        const end = first.end ?? first.pos
        if (pos == null || pos < first.pos || pos > end) {
          this.dismissAltActivated()
          if (altActive && pos != null) {
            this.activatedByAlt = true
            activateHover(this.view, pos, 1, { tooltip: tooltipExt })
          }
        }
      }

      private onMouseLeave = (event: MouseEvent) => {
        this.lastCoords = null
        if (!this.activatedByAlt) return
        const tooltipEl = this.isInsideHoverTooltip(event.relatedTarget)
        if (!tooltipEl) {
          this.dismissAltActivated()
          return
        }
        const onTooltipLeave = (leaveEvent: MouseEvent) => {
          tooltipEl.removeEventListener('mouseleave', onTooltipLeave)
          if (!this.view.dom.contains(leaveEvent.relatedTarget as Node | null)) {
            this.dismissAltActivated()
          }
        }
        tooltipEl.addEventListener('mouseleave', onTooltipLeave)
      }

      private onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && hasHoverTooltips(this.view.state)) {
          this.activatedByAlt = false
          this.view.dispatch({ effects: closeHoverTooltips })
          return
        }
        const wasActive = altHoverActiveViews.has(this.view)
        const active = isHoverModifierActive(event)
        this.setAltActive(active)
        if (active && !wasActive && this.lastCoords) {
          const pos = this.view.posAtCoords(this.lastCoords)
          if (pos != null) {
            this.activatedByAlt = true
            activateHover(this.view, pos, 1, { tooltip: tooltipExt })
          }
        }
      }

      private onKeyUp = (event: KeyboardEvent) => {
        if (!isHoverModifierActive(event)) {
          this.setAltActive(false)
        }
      }

      private onBlur = () => {
        this.setAltActive(false)
        this.dismissAltActivated()
      }

      destroy() {
        this.setAltActive(false)
        window.removeEventListener('keydown', this.onKeyDown)
        window.removeEventListener('keyup', this.onKeyUp)
        window.removeEventListener('blur', this.onBlur)
        this.view.dom.removeEventListener('mousemove', this.onMouseMove)
        this.view.dom.removeEventListener('mouseleave', this.onMouseLeave)
      }
    },
  )

  return [tooltipExt, controller]
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

function jumpToBestDefinition(view: EditorView): boolean {
  const plugin = LSPPlugin.get(view)
  if (!plugin || plugin.client.serverCapabilities?.definitionProvider === false) {
    return false
  }
  plugin.client.sync()
  const pos = view.state.selection.main.head
  void plugin.client
    .withMapping((mapping) =>
      plugin.client
        .request('textDocument/definition', {
          textDocument: { uri: plugin.uri },
          position: plugin.toPosition(pos),
        })
        .then((response) => {
          const loc = pickBestDefinitionLocation(response, plugin.uri)
          if (!loc) return
          return (
            loc.uri === plugin.uri
              ? Promise.resolve(view)
              : plugin.client.workspace.displayFile(loc.uri)
          ).then((target) => {
            if (!target) return
            const targetPos = mapping.getMapping(loc.uri)
              ? mapping.mapPosition(loc.uri, loc.range.start)
              : plugin.fromPosition(loc.range.start, target.state.doc)
            target.dispatch({
              selection: { anchor: targetPos },
              scrollIntoView: true,
              userEvent: 'select.definition',
            })
          })
        }),
    )
    .catch(() => {})
  return true
}

function createCmdClickJumpExtension(): Extension {
  return [
    Prec.highest(
      keymap.of([{ key: 'F12', run: jumpToBestDefinition, preventDefault: true }]),
    ),
    Prec.highest(
      EditorView.domEventHandlers({
        mousedown(event, view) {
          if (!isJumpModifierActive(event) || event.button !== 0) return false
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
          if (pos == null) return false
          event.preventDefault()
          view.dispatch({ selection: { anchor: pos } })
          jumpToBestDefinition(view)
          return true
        },
      }),
    ),
  ]
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
    createAltHoverTooltipExtension(),
    createCmdClickJumpExtension(),
    createCmdHoverUnderlineExtension(),
    createLspTooltipHighlightExtension(options.isDark ?? true, options.language ?? 'typescript'),
  ]
}
