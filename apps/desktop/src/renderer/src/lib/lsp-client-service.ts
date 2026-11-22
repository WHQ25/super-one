import { ChangeSet, Text } from '@codemirror/state'
import { keymap, type EditorView } from '@codemirror/view'
import {
  LSPClient,
  LSPPlugin,
  Workspace,
  findReferencesKeymap,
  formatKeymap,
  jumpToDefinitionKeymap,
  renameKeymap,
  serverCompletion,
  serverDiagnostics,
  signatureHelp,
  type Transport,
  type WorkspaceFile,
} from '@codemirror/lsp-client'
import { resolveLspTarget } from '@superone/shared/lsp-languages'
import { inferLanguage } from '@/lib/shiki-highlighter'
import { openNewFileTab } from '@/components/activity/activity-panel-api'

export function pathToFileUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.startsWith('/')) {
    return `file://${encodeURI(normalized)}`
  }
  return `file:///${encodeURI(normalized)}`
}

export function fileUriToPath(uri: string): string {
  if (!uri.startsWith('file://')) return uri
  let path = decodeURIComponent(uri.slice('file://'.length))
  if (/^\/[A-Za-z]:\//.test(path)) {
    path = path.slice(1)
  }
  return path
}

export function toWorkspaceRelativePath(workspaceRoot: string, fsPath: string): string {
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '')
  const normalizedPath = fsPath.replace(/\\/g, '/')
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : fsPath
}

interface TrackedWorkspaceFile extends WorkspaceFile {
  view: EditorView | null
}

export class SharedLspWorkspace extends Workspace {
  files: TrackedWorkspaceFile[] = []
  private fileVersions: Record<string, number> = Object.create(null)
  private virtualRefs = new Map<string, number>()
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
      if (!file.view) continue
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
      existing.getView = () => view
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
    if (!file || file.view !== view) return
    if ((this.virtualRefs.get(uri) ?? 0) > 0) {
      file.view = null
      file.getView = () => null
      return
    }
    this.files = this.files.filter((f) => f !== file)
    this.client.didClose(uri)
  }

  acquireVirtualFile(uri: string, languageId: string, content: string): () => void {
    const count = (this.virtualRefs.get(uri) ?? 0) + 1
    this.virtualRefs.set(uri, count)
    const existing = this.files.find((f) => f.uri === uri)
    if (!existing) {
      const doc = Text.of(content.replace(/\r\n/g, '\n').split('\n'))
      const file: TrackedWorkspaceFile = {
        uri,
        languageId,
        version: this.nextVersion(uri),
        doc,
        view: null,
        getView: () => null,
      }
      this.files.push(file)
      this.client.didOpen(file)
    }
    let released = false
    return () => {
      if (released) return
      released = true
      const next = (this.virtualRefs.get(uri) ?? 1) - 1
      if (next <= 0) {
        this.virtualRefs.delete(uri)
        const tracked = this.files.find((f) => f.uri === uri)
        if (tracked && !tracked.view) {
          this.files = this.files.filter((f) => f !== tracked)
          this.client.didClose(uri)
        }
      } else {
        this.virtualRefs.set(uri, next)
      }
    }
  }

  async displayFile(uri: string): Promise<EditorView | null> {
    const fsPath = fileUriToPath(uri)
    const relativePath = toWorkspaceRelativePath(this.workspaceRoot, fsPath)
    const existing = this.files.find((f) => f.uri === uri && f.view)
    if (existing?.view) {
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

interface ClientEntry {
  client: LSPClient
  workspace: SharedLspWorkspace
}

const clientCache = new Map<string, ClientEntry>()

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

export function getOrCreateLspClientEntry(serverId: string, workspaceRoot: string): ClientEntry {
  const key = clientKey(serverId, workspaceRoot)
  const existing = clientCache.get(key)
  if (existing) return existing

  let createdWorkspace!: SharedLspWorkspace
  const client = new LSPClient({
    rootUri: pathToFileUri(workspaceRoot),
    workspace: (c) => {
      createdWorkspace = new SharedLspWorkspace(c, workspaceRoot)
      return createdWorkspace
    },
    extensions: [
      serverCompletion(),
      keymap.of([
        ...formatKeymap,
        ...renameKeymap,
        ...jumpToDefinitionKeymap,
        ...findReferencesKeymap,
      ]),
      signatureHelp(),
      serverDiagnostics(),
    ],
    timeout: 8000,
  })
  client.connect(createIpcTransport(serverId, workspaceRoot))
  const entry: ClientEntry = { client, workspace: createdWorkspace }
  clientCache.set(key, entry)
  return entry
}

export function disposeLspClient(serverId: string, workspaceRoot: string): void {
  const key = clientKey(serverId, workspaceRoot)
  const entry = clientCache.get(key)
  if (!entry) return
  entry.client.disconnect()
  clientCache.delete(key)
}

export interface ResolvedLspServer {
  serverId: string
  languageId: string
}

export async function resolveEnabledLspServer(
  filePath: string,
  language?: string | null,
): Promise<ResolvedLspServer | null> {
  if (typeof window.app?.listLspServers !== 'function') return null
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const inferred = language ?? inferLanguage(filePath)
  const langLower = inferred.toLowerCase()
  const candidates = [langLower, ext].filter((v) => v && v !== 'text')
  if (candidates.length === 0) return null

  const servers = await window.app.listLspServers().catch(() => [])
  const enabledMatch = servers.find(
    (s) =>
      s.installStatus === 'installed' &&
      s.enabled &&
      candidates.some((c) => s.languages.includes(c)),
  )
  if (!enabledMatch) return null

  const staticTarget = resolveLspTarget(inferred !== 'text' ? inferred : ext)
  return {
    serverId: enabledMatch.id,
    languageId: staticTarget?.languageId ?? candidates[0] ?? 'plaintext',
  }
}

export interface LspDefinitionTarget {
  uri: string
  fsPath: string
  relativePath: string
  line: number
  character: number
}

interface RawLspRange {
  start?: { line?: number; character?: number }
}

interface RawLspLocation {
  uri?: string
  targetUri?: string
  range?: RawLspRange
  targetSelectionRange?: RawLspRange
  targetRange?: RawLspRange
}

export async function queryLspDefinition(
  client: LSPClient,
  workspaceRoot: string,
  uri: string,
  line0: number,
  character0: number,
): Promise<LspDefinitionTarget | null> {
  if (client.serverCapabilities?.definitionProvider === false) return null
  try {
    await client.initializing
    const result = await client.request('textDocument/definition', {
      textDocument: { uri },
      position: { line: Math.max(0, line0), character: Math.max(0, character0) },
    })
    const items = Array.isArray(result) ? result : result ? [result] : []
    const first = items[0] as RawLspLocation | undefined
    if (!first) return null
    const targetUri = first.targetUri ?? first.uri
    const range = first.targetSelectionRange ?? first.targetRange ?? first.range
    if (!targetUri) return null
    const fsPath = fileUriToPath(targetUri)
    return {
      uri: targetUri,
      fsPath,
      relativePath: toWorkspaceRelativePath(workspaceRoot, fsPath),
      line: (range?.start?.line ?? 0) + 1,
      character: range?.start?.character ?? 0,
    }
  } catch {
    return null
  }
}

function formatHoverContents(raw: unknown): string {
  if (!raw) return ''
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) {
    return raw.map(formatHoverContents).filter(Boolean).join('\n\n')
  }
  if (typeof raw === 'object') {
    const obj = raw as { kind?: string; value?: string; language?: string }
    if (typeof obj.language === 'string' && typeof obj.value === 'string') {
      return `\`\`\`${obj.language}\n${obj.value}\n\`\`\``
    }
    if (typeof obj.value === 'string') return obj.value
  }
  return ''
}

export async function queryLspHover(
  client: LSPClient,
  uri: string,
  line0: number,
  character0: number,
): Promise<string | null> {
  if (client.serverCapabilities?.hoverProvider === false) return null
  try {
    await client.initializing
    const result = await client.request('textDocument/hover', {
      textDocument: { uri },
      position: { line: Math.max(0, line0), character: Math.max(0, character0) },
    }) as { contents?: unknown } | null
    const text = formatHoverContents(result?.contents).trim()
    return text || null
  } catch {
    return null
  }
}
