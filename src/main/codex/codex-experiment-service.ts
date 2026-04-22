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

export class CodexExperimentService {
  private projectAuth = new Map<string, CodexProjectAuth>()
  private authChangedListeners = new Map<string, Set<() => void>>()

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

  private async withAppServerConnection<T>(
    auth: CodexProjectAuth,
    signal: AbortSignal | undefined,
    fn: (connection: AppServerConnection) => Promise<T>,
  ): Promise<T> {
    const handle = await createAppServerConnection(auth, signal)
    try {
      return await fn(handle.connection)
    } catch (error) {
      const stderr = handle.getStderr().trim()
      if (stderr) {
        log.error('[codex] app-server error:', error instanceof Error ? error.message : String(error))
        log.error('[codex] app-server stderr:', stderr)
        const message = error instanceof Error ? error.message : String(error)
        const debugLogPath = String(log.transports.file.getFile().path)
        throw new Error(`${message}\n${stderr}\nDebug log: ${debugLogPath}`)
      }
      throw error
    } finally {
      await handle.close()
    }
  }

  private async fetchModelsFromAppServer(auth: CodexProjectAuth): Promise<ModelOption[]> {
    return this.withAppServerConnection(auth, undefined, async (connection) => {
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
    const models = await this.fetchModelsFromAppServer(auth)
    log.info('[codex] listModels: fetched %d models', models.length)
    return models
  }

  async withAppServerRequest<T>(
    projectPath: string,
    fn: (request: AppServerConnection['request']) => Promise<T>,
  ): Promise<T> {
    const auth = this.getProjectAuth(projectPath)
    return this.withAppServerConnection(auth, undefined, async (connection) => fn(connection.request))
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
    this.emitAuthChanged(projectPath)
    this.authChangedListeners.delete(projectPath)
  }

  dispose(): void {
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
