import { ChangeSet, Prec, StateEffect, StateField, type Extension, type Text } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view'
import {
  LSPClient,
  LSPPlugin,
  Workspace,
  jumpToDefinition,
  languageServerExtensions,
  type Transport,
  type WorkspaceFile,
} from '@codemirror/lsp-client'
import type { BundledLanguage } from 'shiki'
import { resolveLspTarget } from '@superone/shared/lsp-languages'
import { openNewFileTab } from '@/components/activity/activity-panel-api'
import { getFileHighlighter, getFileHighlighterSync, getShikiTarget } from '@/lib/shiki-highlighter'

function pathToFileUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.startsWith('/')) {
    return `file://${encodeURI(normalized)}`
  }
  return `file:///${encodeURI(normalized)}`
}

function fileUriToPath(uri: string): string {
  if (!uri.startsWith('file://')) return uri
  let path = decodeURIComponent(uri.slice('file://'.length))
  if (/^\/[A-Za-z]:\//.test(path)) {
    path = path.slice(1)
  }
  return path
}

interface TrackedWorkspaceFile extends WorkspaceFile {
  view: EditorView
}

class SuperOneWorkspace extends Workspace {
  files: TrackedWorkspaceFile[] = []
  private fileVersions: Record<string, number> = Object.create(null)
  private pendingOpenWaiters = new Map<string, Array<(view: EditorView | null) => void>>()

  constructor(
    client: LSPClient,
    private readonly workspaceRoot: string,
  ) {
    super(client)
  }

  private nextVersion(uri: string): number {
    this.fileVersions[uri] = (this.fileVersions[uri] ?? -1) + 1
    return this.fileVersions[uri]
  }

  syncFiles() {
    const result: Array<{ file: WorkspaceFile; prevDoc: Text; changes: ChangeSet }> = []
    for (const file of this.files) {
      const plugin = LSPPlugin.get(file.view)
      if (!plugin) continue
      const changes = plugin.unsyncedChanges
      if (!changes.empty) {
        result.push({ changes, file, prevDoc: file.doc })
        file.doc = file.view.state.doc
        file.version = this.nextVersion(file.uri)
        plugin.clear()
      }
    }
    return result
  }

  openFile(uri: string, languageId: string, view: EditorView): void {
    const existing = this.files.find((f) => f.uri === uri)
    if (existing) {
      existing.view = view
      existing.doc = view.state.doc
    } else {
      const file: TrackedWorkspaceFile = {
        uri,
        languageId,
        version: this.nextVersion(uri),
        doc: view.state.doc,
        view,
        getView: () => view,
      }
      this.files.push(file)
      this.client.didOpen(file)
    }
    const waiters = this.pendingOpenWaiters.get(uri)
    if (waiters) {
      this.pendingOpenWaiters.delete(uri)
      for (const resolve of waiters) resolve(view)
    }
  }

  closeFile(uri: string, view: EditorView): void {
    const file = this.files.find((f) => f.uri === uri)
    if (file && file.view === view) {
      this.files = this.files.filter((f) => f !== file)
      this.client.didClose(uri)
    }
  }

  async displayFile(uri: string): Promise<EditorView | null> {
    const fsPath = fileUriToPath(uri)
    const normalizedRoot = this.workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '')
    const normalizedPath = fsPath.replace(/\\/g, '/')
    const relativePath = normalizedPath.startsWith(`${normalizedRoot}/`)
      ? normalizedPath.slice(normalizedRoot.length + 1)
      : fsPath

    const existing = this.files.find((f) => f.uri === uri)
    if (existing) {
      openNewFileTab(relativePath, { fileRoot: this.workspaceRoot })
      return existing.view
    }

    const waitForOpen = new Promise<EditorView | null>((resolve) => {
      const list = this.pendingOpenWaiters.get(uri) ?? []
      const timer = setTimeout(() => {
        const remaining = this.pendingOpenWaiters.get(uri)
        if (remaining) {
          this.pendingOpenWaiters.set(
            uri,
            remaining.filter((fn) => fn !== finish),
          )
        }
        resolve(null)
      }, 2500)
      const finish = (v: EditorView | null) => {
        clearTimeout(timer)
        resolve(v)
      }
      list.push(finish)
      this.pendingOpenWaiters.set(uri, list)
    })

    openNewFileTab(relativePath, { fileRoot: this.workspaceRoot })
    return waitForOpen
  }
}

const clientCache = new Map<string, LSPClient>()

function clientKey(serverId: string, workspaceRoot: string): string {
  return `${serverId}::${workspaceRoot}`
}

function createIpcTransport(serverId: string, workspaceRoot: string): Transport {
  const handlers = new Set<(value: string) => void>()
  let unsubscribeIpc: (() => void) | null = null

  const ensureSubscribed = () => {
    if (unsubscribeIpc) return
    unsubscribeIpc = window.app.onLspMessage((payload) => {
      if (payload.serverId !== serverId || payload.workspaceRoot !== workspaceRoot) return
      for (const handler of handlers) {
        handler(payload.message)
      }
    })
  }

  return {
    send(message: string) {
      void window.app.sendLspMessage(serverId, workspaceRoot, message)
    },
    subscribe(handler: (value: string) => void) {
      handlers.add(handler)
      ensureSubscribed()
    },
    unsubscribe(handler: (value: string) => void) {
      handlers.delete(handler)
      if (handlers.size === 0 && unsubscribeIpc) {
        unsubscribeIpc()
        unsubscribeIpc = null
      }
    },
  }
}

function getOrCreateClient(serverId: string, workspaceRoot: string): LSPClient {
  const key = clientKey(serverId, workspaceRoot)
  const existing = clientCache.get(key)
  if (existing) return existing

  const client = new LSPClient({
    rootUri: pathToFileUri(workspaceRoot),
    workspace: (c) => new SuperOneWorkspace(c, workspaceRoot),
    extensions: languageServerExtensions(),
    timeout: 8000,
  })
  client.connect(createIpcTransport(serverId, workspaceRoot))
  clientCache.set(key, client)
  return client
}

export function disposeLspClient(serverId: string, workspaceRoot: string): void {
  const key = clientKey(serverId, workspaceRoot)
  const client = clientCache.get(key)
  if (!client) return
  client.disconnect()
  clientCache.delete(key)
}

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
  const ext = options.filePath.split('.').pop()?.toLowerCase() ?? ''
  const langLower = options.language?.toLowerCase() ?? ''
  const candidates = [langLower, ext].filter((v) => v && v !== 'text')

  const servers = await window.app.listLspServers().catch(() => [])
  const enabledMatch = servers.find(
    (s) =>
      s.installStatus === 'installed' &&
      s.enabled &&
      candidates.some((c) => s.languages.includes(c)),
  )

  const staticTarget = resolveLspTarget(options.language)
  if (!enabledMatch) return []
  const target = {
    serverId: enabledMatch.id,
    languageId: staticTarget?.languageId ?? candidates[0] ?? 'plaintext',
  }
  const client = getOrCreateClient(target.serverId, options.workspaceRoot)
  return [
    client.plugin(pathToFileUri(options.filePath), target.languageId),
    createCmdClickJumpExtension(),
    createCmdHoverUnderlineExtension(),
    createLspTooltipHighlightExtension(options.isDark ?? true, options.language ?? 'typescript'),
  ]
}
