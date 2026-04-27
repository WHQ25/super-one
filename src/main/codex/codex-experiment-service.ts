import log from '../logger'
import {
  compactRecord,
  createAppServerConnection,
  mapAppServerModel,
  normalizeApiKey,
  readString,
  resolveApiKey,
  resolveMode,
  type AppServerConnection,
  type AppServerConnectionHandle,
  type CodexAppServerModel,
  type CodexProjectAuth,
} from './app-server-connection'
import type {
  CodexAuthStatus,
  CodexReasoningEffort,
  CodexSetAuthRequest,
  ModelOption,
  ReasoningEffortOption,
} from '../../shared/agent-types'

const APP_SERVER_METADATA_IDLE_MS = 5 * 60_000

export {
  createCodexSession,
  codexSessionNeedsRebuild,
  type CodexSession,
  type PendingCodexApproval,
  type CodexApprovalDecision,
  type PendingCodexApprovalResponse,
  type AppServerUserInputQuestion,
} from './codex-session'

export type { CodexRunStreamCallbacks } from './codex-turn'

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function toReasoningEffort(value: unknown): CodexReasoningEffort | null {
  return value === 'minimal'
    || value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'xhigh'
    ? value
    : null
}

function parseAppServerModel(raw: unknown): CodexAppServerModel | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (readBoolean(rec.hidden) === true) return null
  const model = readString(rec.model) ?? readString(rec.id)
  const id = readString(rec.id) ?? model
  if (!id || !model) return null

  const reasoningEfforts = Array.isArray(rec.supportedReasoningEfforts)
    ? rec.supportedReasoningEfforts
    : Array.isArray(rec.reasoningEffort)
      ? rec.reasoningEffort
      : []

  return {
    id,
    model,
    displayName: typeof rec.displayName === 'string' ? rec.displayName : model,
    description: typeof rec.description === 'string' ? rec.description : '',
    isDefault: rec.isDefault === true,
    supportedReasoningEfforts: Array.isArray(reasoningEfforts)
      ? reasoningEfforts
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return null
            const effort = toReasoningEffort(
              (entry as Record<string, unknown>).reasoningEffort
              ?? (entry as Record<string, unknown>).effort,
            )
            const description = (entry as Record<string, unknown>).description
            if (!effort) return null
            return {
              value: effort,
              description: typeof description === 'string' ? description : effort,
            } satisfies ReasoningEffortOption
          })
          .filter((entry): entry is ReasoningEffortOption => Boolean(entry))
      : [],
    defaultReasoningEffort: toReasoningEffort(rec.defaultReasoningEffort) ?? undefined,
  }
}

function authsEqual(a: CodexProjectAuth, b: CodexProjectAuth): boolean {
  return a.mode === b.mode && normalizeApiKey(a.apiKey) === normalizeApiKey(b.apiKey)
}

interface CachedAppServerConnection {
  auth: CodexProjectAuth
  handlePromise: Promise<AppServerConnectionHandle>
  handle: AppServerConnectionHandle | null
  inFlight: number
  idleTimer: ReturnType<typeof setTimeout> | null
  claimed: boolean
}

export class CodexExperimentService {
  private projectAuth = new Map<string, CodexProjectAuth>()
  private authChangedListeners = new Map<string, Set<() => void>>()
  private appServerConnections = new Map<string, CachedAppServerConnection>()

  getProjectAuth(projectPath: string): CodexProjectAuth {
    let auth = this.projectAuth.get(projectPath)
    if (!auth) {
      auth = { mode: 'auto' }
      this.projectAuth.set(projectPath, auth)
    }
    return auth
  }

  onAuthChanged(projectPath: string, cb: () => void): () => void {
    let set = this.authChangedListeners.get(projectPath)
    if (!set) {
      set = new Set()
      this.authChangedListeners.set(projectPath, set)
    }
    set.add(cb)
    return () => { set!.delete(cb) }
  }

  private emitAuthChanged(projectPath: string): void {
    const set = this.authChangedListeners.get(projectPath)
    if (!set) return
    for (const cb of set) {
      try { cb() } catch (err) { log.warn('[codex] auth-changed listener error:', err) }
    }
  }

  private async closeAppServerConnection(projectPath: string): Promise<void> {
    const cached = this.appServerConnections.get(projectPath)
    if (!cached) return
    this.appServerConnections.delete(projectPath)
    if (cached.idleTimer) clearTimeout(cached.idleTimer)
    try {
      const handle = cached.handle ?? await cached.handlePromise
      await handle.close()
    } catch (err) {
      log.debug('[codex] metadata app-server close failed: %s', err instanceof Error ? err.message : String(err))
    }
  }

  private getCachedAppServerConnection(
    projectPath: string,
    auth: CodexProjectAuth,
    signal: AbortSignal | undefined,
  ): CachedAppServerConnection {
    const existing = this.appServerConnections.get(projectPath)
    if (existing && authsEqual(existing.auth, auth)) {
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer)
        existing.idleTimer = null
      }
      return existing
    }
    if (existing) void this.closeAppServerConnection(projectPath)

    const cached: CachedAppServerConnection = {
      auth: { mode: auth.mode, apiKey: normalizeApiKey(auth.apiKey) },
      handlePromise: Promise.resolve(null as never),
      handle: null,
      inFlight: 0,
      idleTimer: null,
      claimed: false,
    }
    const startedAt = Date.now()
    cached.handlePromise = createAppServerConnection(auth, signal)
      .then((handle) => {
        if (this.appServerConnections.get(projectPath) !== cached && !cached.claimed) {
          void handle.close().catch(() => {})
          return handle
        }
        cached.handle = handle
        log.info('[codex] metadata app-server ready project=%s durMs=%d', projectPath, Date.now() - startedAt)
        handle.onClosed((info) => {
          if (this.appServerConnections.get(projectPath) === cached) {
            this.appServerConnections.delete(projectPath)
            if (cached.idleTimer) clearTimeout(cached.idleTimer)
            log.info('[codex] metadata app-server exited code=%s signal=%s', info.code, info.signal)
          }
        })
        return handle
      })
      .catch((err) => {
        if (this.appServerConnections.get(projectPath) === cached) {
          this.appServerConnections.delete(projectPath)
        }
        throw err
      })
    this.appServerConnections.set(projectPath, cached)
    return cached
  }

  prewarmAppServerConnection(projectPath: string): void {
    const auth = this.getProjectAuth(projectPath)
    const cached = this.getCachedAppServerConnection(projectPath, auth, undefined)
    void cached.handlePromise.catch((err) => {
      log.warn('[codex] metadata app-server prewarm failed: %s', err instanceof Error ? err.message : String(err))
    })
  }

  async takeAppServerConnection(
    projectPath: string,
    auth: CodexProjectAuth,
  ): Promise<AppServerConnectionHandle | null> {
    const cached = this.appServerConnections.get(projectPath)
    if (!cached || !authsEqual(cached.auth, auth) || cached.inFlight > 0) return null
    this.appServerConnections.delete(projectPath)
    cached.claimed = true
    if (cached.idleTimer) {
      clearTimeout(cached.idleTimer)
      cached.idleTimer = null
    }
    try {
      return await cached.handlePromise
    } catch (err) {
      log.debug('[codex] take metadata app-server failed: %s', err instanceof Error ? err.message : String(err))
      return null
    }
  }

  releaseAppServerConnection(
    projectPath: string,
    auth: CodexProjectAuth,
    handle: AppServerConnectionHandle,
  ): void {
    if (this.appServerConnections.has(projectPath)) {
      void handle.close().catch(() => {})
      return
    }
    const cached: CachedAppServerConnection = {
      auth: { mode: auth.mode, apiKey: normalizeApiKey(auth.apiKey) },
      handlePromise: Promise.resolve(handle),
      handle,
      inFlight: 0,
      idleTimer: null,
      claimed: false,
    }
    handle.onClosed((info) => {
      if (this.appServerConnections.get(projectPath) === cached) {
        this.appServerConnections.delete(projectPath)
        if (cached.idleTimer) clearTimeout(cached.idleTimer)
        log.info('[codex] metadata app-server exited code=%s signal=%s', info.code, info.signal)
      }
    })
    this.appServerConnections.set(projectPath, cached)
    this.scheduleAppServerConnectionClose(projectPath, cached)
  }

  private scheduleAppServerConnectionClose(projectPath: string, cached: CachedAppServerConnection): void {
    if (cached.inFlight > 0 || this.appServerConnections.get(projectPath) !== cached) return
    if (cached.idleTimer) clearTimeout(cached.idleTimer)
    cached.idleTimer = setTimeout(() => {
      void this.closeAppServerConnection(projectPath)
    }, APP_SERVER_METADATA_IDLE_MS)
  }

  private async withAppServerConnection<T>(
    projectPath: string,
    auth: CodexProjectAuth,
    signal: AbortSignal | undefined,
    fn: (connection: AppServerConnection) => Promise<T>,
  ): Promise<T> {
    const cached = this.getCachedAppServerConnection(projectPath, auth, signal)
    cached.inFlight += 1
    if (cached.idleTimer) {
      clearTimeout(cached.idleTimer)
      cached.idleTimer = null
    }
    let handle: AppServerConnectionHandle | null = null
    try {
      handle = await cached.handlePromise
      return await fn(handle.connection)
    } catch (error) {
      const stderr = handle?.getStderr().trim() ?? ''
      if (stderr) {
        log.error('[codex] app-server error:', error instanceof Error ? error.message : String(error))
        log.error('[codex] app-server stderr:', stderr)
        await this.closeAppServerConnection(projectPath)
        const message = error instanceof Error ? error.message : String(error)
        const debugLogPath = String(log.transports.file.getFile().path)
        throw new Error(`${message}\n${stderr}\nDebug log: ${debugLogPath}`)
      }
      throw error
    } finally {
      cached.inFlight = Math.max(0, cached.inFlight - 1)
      this.scheduleAppServerConnectionClose(projectPath, cached)
    }
  }

  private async fetchModelsFromAppServer(projectPath: string, auth: CodexProjectAuth): Promise<ModelOption[]> {
    return this.withAppServerConnection(projectPath, auth, undefined, async (connection) => {
      const models: CodexAppServerModel[] = []
      let cursor: string | null = null

      do {
        const result = await connection.request(
          'model/list',
          compactRecord({
            limit: 100,
            cursor: cursor ?? undefined,
          }),
        )

        const items = Array.isArray(result.data) ? result.data : []
        for (const raw of items) {
          const parsed = parseAppServerModel(raw)
          if (parsed) models.push(parsed)
        }

        cursor = readString(result.nextCursor)
      } while (cursor)

      const mapped = models.map((m) => mapAppServerModel(m))
      if (!mapped.some((m) => m.isDefault) && mapped[0]) {
        mapped[0] = { ...mapped[0], isDefault: true }
      }
      return mapped
    })
  }

  async listModels(projectPath: string): Promise<ModelOption[]> {
    const auth = this.getProjectAuth(projectPath)
    log.info('[codex] listModels: mode=%s, hasApiKey=%s', auth.mode, Boolean(auth.apiKey || process.env.CODEX_API_KEY))
    const models = await this.fetchModelsFromAppServer(projectPath, auth)
    log.info('[codex] listModels: fetched %d models', models.length)
    return models
  }

  async withAppServerRequest<T>(
    projectPath: string,
    fn: (request: AppServerConnection['request']) => Promise<T>,
  ): Promise<T> {
    const auth = this.getProjectAuth(projectPath)
    return this.withAppServerConnection(projectPath, auth, undefined, async (connection) => fn(connection.request))
  }

  setAuth(projectPath: string, request: CodexSetAuthRequest): CodexAuthStatus {
    const currentAuth = this.getProjectAuth(projectPath)
    const mode = request.mode
    const apiKey = mode === 'apiKey'
      ? normalizeApiKey(request.apiKey) ?? currentAuth.apiKey
      : undefined

    if (mode === 'apiKey' && !resolveApiKey('apiKey', apiKey)) {
      throw new Error('API key mode requires apiKey or CODEX_API_KEY')
    }

    this.projectAuth.set(projectPath, { mode, apiKey: normalizeApiKey(apiKey) })
    void this.closeAppServerConnection(projectPath)
    this.emitAuthChanged(projectPath)
    return this.getAuthStatus(projectPath)
  }

  getAuthStatus(projectPath: string): CodexAuthStatus {
    const auth = this.getProjectAuth(projectPath)
    return {
      mode: auth.mode,
      resolvedMode: resolveMode(auth.mode, auth.apiKey),
      hasEnvApiKey: Boolean(normalizeApiKey(process.env.CODEX_API_KEY)),
      hasSessionApiKey: Boolean(normalizeApiKey(auth.apiKey)),
      isRunning: false,
    }
  }

  closeProject(projectPath: string): void {
    this.projectAuth.delete(projectPath)
    void this.closeAppServerConnection(projectPath)
    this.emitAuthChanged(projectPath)
    this.authChangedListeners.delete(projectPath)
  }

  dispose(): void {
    for (const projectPath of this.appServerConnections.keys()) {
      void this.closeAppServerConnection(projectPath)
    }
    this.projectAuth.clear()
    this.authChangedListeners.clear()
  }
}

let sharedCodexService: CodexExperimentService | null = null
export function getSharedCodexService(): CodexExperimentService {
  if (!sharedCodexService) sharedCodexService = new CodexExperimentService()
  return sharedCodexService
}
export function setSharedCodexServiceForTest(instance: CodexExperimentService | null): void {
  sharedCodexService = instance
}

export function parseAppServerModelForTest(raw: unknown): CodexAppServerModel | null {
  return parseAppServerModel(raw)
}
