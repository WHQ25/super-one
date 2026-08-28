import { createHash, randomUUID } from 'crypto'
import log from '../logger'
import { authHeaders, modelsUrl } from '../providers/endpoint-test'
import { parseOpenAiModelsList } from '@superone/shared/platform-registry'
import { parseAccountLoginStart, parseAccountStatus, parseAccountUsage, readCodexConfigRequirements, readCodexServerDiagnostics } from '@superone/codex'
import {
  buildCodexAccountEnv,
  buildCodexProviderCliOverridesFor,
  compactRecord,
  createAppServerConnection,
  getCodexProviderOverrideFor,
  limitAppServerStderrDiagnostic,
  mapAppServerModel,
  normalizeApiKey,
  readAppServerStderrSince,
  readString,
  resolveApiKey,
  resolveMode,
  type AppServerConnection,
  type AppServerConnectionHandle,
  type CodexAppServerModel,
  type CodexProjectAuth,
} from './app-server-connection'
import { clearCodexProxyCache } from '../providers/llm-proxy-manager'
import { resolveChatService } from '../providers/resolver'
import { codexReasoningOptions, resolveCodexChatReasoning } from '../providers/codex-responses/reasoning'
import type {
  CodexAccountLoginStartResult,
  CodexAccountStatus,
  CodexAuthStatus,
  CodexAccountUsage,
  CodexConfigRequirements,
  CodexExternalAgentItem,
  CodexExternalAgentImportResult,
  CodexMcpOauthLoginResult,
  CodexMcpOauthLoginOptions,
  CodexRateLimits,
  CodexRateLimitResetCredit,
  CodexRateLimitResetOutcome,
  CodexRateLimitWindow,
  CodexReasoningEffort,
  CodexSetAuthRequest,
  CodexServerDiagnostics,
  ModelOption,
  ReasoningEffortOption,
} from '@superone/shared/agent-types'

const APP_SERVER_METADATA_IDLE_MS = 5 * 60_000
const APP_SERVER_EPHEMERAL_CLOSE_TIMEOUT_MS = 5_000
const MODEL_CACHE_TTL_MS = 3 * 60_000
const CUSTOM_PROVIDER_MODELS_TIMEOUT_MS = 10_000

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
    || value === 'max'
    || value === 'ultra'
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
  const parsedServiceTiers = Array.isArray(rec.serviceTiers)
    ? rec.serviceTiers
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null
          const tier = entry as Record<string, unknown>
          const tierId = readString(tier.id)
          if (!tierId) return null
          return {
            id: tierId,
            name: readString(tier.name) ?? tierId,
            description: readString(tier.description) ?? '',
          }
        })
        .filter((entry): entry is { id: string; name: string; description: string } => entry !== null)
    : []
  const serviceTiers = parsedServiceTiers.length > 0
    ? parsedServiceTiers
    : Array.isArray(rec.additionalSpeedTiers)
      ? rec.additionalSpeedTiers
          .filter((tier): tier is string => typeof tier === 'string')
          .map((tier) => ({ id: tier, name: tier === 'fast' ? 'Fast' : tier, description: '' }))
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
    multiAgentVersion: rec.multiAgentVersion === 'disabled'
      || rec.multiAgentVersion === 'v1'
      || rec.multiAgentVersion === 'v2'
      ? rec.multiAgentVersion
      : null,
    retirementAt: readFiniteNumber(
      rec.upgradeInfo && typeof rec.upgradeInfo === 'object'
        ? (rec.upgradeInfo as Record<string, unknown>).retirementAt
        : null,
    ),
    serviceTiers,
    defaultServiceTier: readString(rec.defaultServiceTier),
  }
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseRateLimitWindow(raw: unknown): CodexRateLimitWindow | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const usedPercent = readFiniteNumber(rec.usedPercent)
  if (usedPercent === null) return null
  return {
    usedPercent,
    windowDurationMins: readFiniteNumber(rec.windowDurationMins),
    resetsAt: readFiniteNumber(rec.resetsAt),
  }
}

function parseRateLimits(raw: Record<string, unknown>): CodexRateLimits | null {
  const snapshot = raw.rateLimits && typeof raw.rateLimits === 'object'
    ? (raw.rateLimits as Record<string, unknown>)
    : raw
  const primary = parseRateLimitWindow(snapshot.primary)
  const secondary = parseRateLimitWindow(snapshot.secondary)
  if (!primary && !secondary) return null
  const resetCreditsRaw = raw.rateLimitResetCredits
  const resetSummary = resetCreditsRaw && typeof resetCreditsRaw === 'object'
    ? (resetCreditsRaw as Record<string, unknown>)
    : null
  const resetCredits = resetSummary ? readNumericLike(resetSummary.availableCount) : null
  const creditsRaw = resetSummary?.credits
  const resetCreditList = Array.isArray(creditsRaw)
    ? creditsRaw.map(parseResetCredit).filter((c): c is CodexRateLimitResetCredit => c !== null)
    : undefined
  return {
    primary,
    secondary,
    planType: readString(snapshot.planType),
    resetCredits,
    ...(resetCreditList && resetCreditList.length > 0 ? { resetCreditList } : {}),
  }
}

function parseResetCredit(raw: unknown): CodexRateLimitResetCredit | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const id = readString(rec.id)
  if (!id) return null
  const rawStatus = readString(rec.status)
  const status: CodexRateLimitResetCredit['status'] =
    rawStatus === 'available' || rawStatus === 'redeeming' || rawStatus === 'redeemed' ? rawStatus : 'unknown'
  return {
    id,
    status,
    title: readString(rec.title) ?? null,
    description: readString(rec.description) ?? null,
    expiresAt: readNumericLike(rec.expiresAt),
  }
}

function parseExternalAgentItem(raw: unknown): CodexExternalAgentItem | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const itemType = readString(rec.itemType)
  if (!itemType) return null
  return {
    itemType,
    description: readString(rec.description) ?? '',
    cwd: readString(rec.cwd) ?? null,
    ...(rec.details !== undefined ? { details: rec.details } : {}),
  }
}

function summarizeImportResults(raw: unknown): CodexExternalAgentImportResult {
  const results = Array.isArray(raw) ? raw : []
  let successCount = 0
  let failureCount = 0
  for (const result of results) {
    if (!result || typeof result !== 'object') continue
    const rec = result as Record<string, unknown>
    if (Array.isArray(rec.successes)) successCount += rec.successes.length
    if (Array.isArray(rec.failures)) failureCount += rec.failures.length
  }
  return { successCount, failureCount }
}

function parseResetOutcome(raw: Record<string, unknown>): CodexRateLimitResetOutcome {
  switch (readString(raw.outcome)) {
    case 'reset': return 'reset'
    case 'nothingToReset': return 'nothingToReset'
    case 'noCredit': return 'noCredit'
    case 'alreadyRedeemed': return 'alreadyRedeemed'
    default: return 'unknown'
  }
}

function readNumericLike(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function authsEqual(a: CodexProjectAuth, b: CodexProjectAuth): boolean {
  return a.mode === b.mode && normalizeApiKey(a.apiKey) === normalizeApiKey(b.apiKey)
}

function codexProviderSignature(apiProviderId?: string | null): string {
  const resolved = resolveChatService('codex', apiProviderId ?? null)
  if (!resolved) return ''
  return [
    resolved.credentialId,
    resolved.endpointId,
    resolved.protocol,
    resolved.baseUrl.trim(),
  ].join('|')
}

function modelCacheSignature(auth: CodexProjectAuth, apiProviderId?: string | null): string {
  const resolved = resolveChatService('codex', apiProviderId ?? null)
  const apiKey = resolved?.apiKey || normalizeApiKey(auth.apiKey) || ''
  const apiKeyFingerprint = apiKey
    ? createHash('sha256').update(apiKey).digest('hex').slice(0, 16)
    : ''
  return `${codexProviderSignature(apiProviderId)}::${auth.mode}:${apiKeyFingerprint}`
}

function modelOptionsFromOpenAiList(payload: unknown, platformId?: string): ModelOption[] | null {
  const models = parseOpenAiModelsList(payload)
  if (!models) return null
  const reasoning = resolveCodexChatReasoning(platformId)
  const supportedReasoningEfforts = codexReasoningOptions(reasoning)
  return models.map((model, index) => ({
    id: model.id,
    name: model.name ?? model.id,
    description: '',
    isDefault: index === 0,
    supportedReasoningEfforts,
    defaultReasoningEffort: reasoning?.defaultEffort,
  }))
}

interface CachedModelList {
  models: ModelOption[]
  expiresAt: number
}

interface CachedAppServerConnection {
  auth: CodexProjectAuth
  providerSig: string
  handlePromise: Promise<AppServerConnectionHandle>
  handle: AppServerConnectionHandle | null
  inFlight: number
  idleTimer: ReturnType<typeof setTimeout> | null
  claimed: boolean
}

interface PendingAccountLogin {
  projectPath: string
  handle: AppServerConnectionHandle
}

function throwAppServerRequestError(error: unknown, stderr: string): never {
  log.error('[codex] app-server error:', error instanceof Error ? error.message : String(error))
  log.error('[codex] app-server stderr:', stderr)
  const message = error instanceof Error ? error.message : String(error)
  const debugLogPath = String(log.transports.file.getFile().path)
  throw new Error(`${message}\n${limitAppServerStderrDiagnostic(stderr)}\nDebug log: ${debugLogPath}`)
}

async function closeEphemeralAppServer(handle: AppServerConnectionHandle): Promise<void> {
  let unsubscribe = () => {}
  let timeout: ReturnType<typeof setTimeout> | null = null
  const exited = new Promise<void>((resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('Codex ephemeral app-server did not exit after close'))
    }, APP_SERVER_EPHEMERAL_CLOSE_TIMEOUT_MS)
    timeout.unref?.()
    unsubscribe = handle.onClosed(() => resolve())
  })

  try {
    await handle.close()
    await exited
  } finally {
    if (timeout) clearTimeout(timeout)
    unsubscribe()
  }
}

export class CodexExperimentService {
  private projectAuth = new Map<string, CodexProjectAuth>()
  private authChangedListeners = new Map<string, Set<() => void>>()
  private appServerConnections = new Map<string, CachedAppServerConnection>()
  private modelCacheByProvider = new Map<string, CachedModelList>()
  private pendingAccountLogins = new Map<string, PendingAccountLogin>()

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

  private async createAccountConnection(): Promise<AppServerConnectionHandle> {
    return createAppServerConnection(
      { mode: 'chatgpt' },
      undefined,
      buildCodexAccountEnv(),
      [],
    )
  }

  private invalidateAccountConsumers(): void {
    const projects = new Set([
      ...this.projectAuth.keys(),
      ...this.authChangedListeners.keys(),
      ...this.appServerConnections.keys(),
    ])
    for (const projectPath of [...this.appServerConnections.keys()]) {
      void this.closeAppServerConnection(projectPath)
    }
    for (const projectPath of projects) this.emitAuthChanged(projectPath)
  }

  private async waitForAccountLogin(
    loginId: string,
    pending: PendingAccountLogin,
  ): Promise<void> {
    const deadline = Date.now() + 15 * 60_000
    try {
      while (Date.now() < deadline && this.pendingAccountLogins.get(loginId) === pending) {
        const notification = pending.handle.connection.pollNotification
          ? await pending.handle.connection.pollNotification(Math.min(1_000, deadline - Date.now()))
          : await pending.handle.connection.nextNotification()
        if (!notification) continue
        if (
          notification.method === 'account/login/completed'
          && readString(notification.params.loginId) === loginId
        ) {
          if (readBoolean(notification.params.success) === true) {
            this.invalidateAccountConsumers()
          } else {
            log.info(
              '[codex] ChatGPT login failed project=%s: %s',
              pending.projectPath,
              readString(notification.params.error) ?? 'unknown error',
            )
          }
          return
        }
      }
      log.info('[codex] ChatGPT login timed out project=%s', pending.projectPath)
    } catch (error) {
      log.info(
        '[codex] ChatGPT login listener failed project=%s: %s',
        pending.projectPath,
        error instanceof Error ? error.message : String(error),
      )
    } finally {
      if (this.pendingAccountLogins.get(loginId) === pending) {
        this.pendingAccountLogins.delete(loginId)
      }
      await pending.handle.close().catch(() => {})
    }
  }

  async getAccountStatus(): Promise<CodexAccountStatus> {
    const handle = await this.createAccountConnection()
    try {
      return parseAccountStatus(await handle.connection.request('account/read', { refreshToken: false }))
    } finally {
      await handle.close().catch(() => {})
    }
  }

  async startAccountLogin(projectPath: string): Promise<CodexAccountLoginStartResult> {
    const handle = await this.createAccountConnection()
    try {
      const result = parseAccountLoginStart(await handle.connection.request('account/login/start', {
        type: 'chatgpt',
        useHostedLoginSuccessPage: true,
        appBrand: 'chatgpt',
      }))
      const pending = { projectPath, handle }
      this.pendingAccountLogins.set(result.loginId, pending)
      void this.waitForAccountLogin(result.loginId, pending)
      return result
    } catch (error) {
      await handle.close().catch(() => {})
      throw error
    }
  }

  async cancelAccountLogin(loginId: string): Promise<void> {
    const pending = this.pendingAccountLogins.get(loginId)
    if (!pending) return
    this.pendingAccountLogins.delete(loginId)
    try {
      await pending.handle.connection.request('account/login/cancel', { loginId })
    } finally {
      await pending.handle.close().catch(() => {})
    }
  }

  async logoutAccount(): Promise<CodexAccountStatus> {
    for (const loginId of [...this.pendingAccountLogins.keys()]) {
      await this.cancelAccountLogin(loginId)
    }
    const handle = await this.createAccountConnection()
    try {
      await handle.connection.request('account/logout')
      const status = parseAccountStatus(await handle.connection.request('account/read', { refreshToken: false }))
      this.invalidateAccountConsumers()
      return status
    } finally {
      await handle.close().catch(() => {})
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
    apiProviderId?: string | null,
  ): CachedAppServerConnection {
    const sig = codexProviderSignature(apiProviderId)
    const existing = this.appServerConnections.get(projectPath)
    if (existing && authsEqual(existing.auth, auth) && existing.providerSig === sig) {
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer)
        existing.idleTimer = null
      }
      return existing
    }
    if (existing) void this.closeAppServerConnection(projectPath)

    const cached: CachedAppServerConnection = {
      auth: { mode: auth.mode, apiKey: normalizeApiKey(auth.apiKey) },
      providerSig: sig,
      handlePromise: Promise.resolve(null as never),
      handle: null,
      inFlight: 0,
      idleTimer: null,
      claimed: false,
    }
    const startedAt = Date.now()
    cached.handlePromise = createAppServerConnection(
      auth,
      signal,
      undefined,
      buildCodexProviderCliOverridesFor(apiProviderId),
      apiProviderId,
    )
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
    apiProviderId?: string | null,
  ): Promise<AppServerConnectionHandle | null> {
    const cached = this.appServerConnections.get(projectPath)
    if (!cached || !authsEqual(cached.auth, auth) || cached.providerSig !== codexProviderSignature(apiProviderId) || cached.inFlight > 0) return null
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
    apiProviderId?: string | null,
  ): void {
    if (this.appServerConnections.has(projectPath)) {
      void handle.close().catch(() => {})
      return
    }
    const cached: CachedAppServerConnection = {
      auth: { mode: auth.mode, apiKey: normalizeApiKey(auth.apiKey) },
      providerSig: codexProviderSignature(apiProviderId),
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
    apiProviderId?: string | null,
  ): Promise<T> {
    const cached = this.getCachedAppServerConnection(projectPath, auth, signal, apiProviderId)
    cached.inFlight += 1
    if (cached.idleTimer) {
      clearTimeout(cached.idleTimer)
      cached.idleTimer = null
    }
    let handle: AppServerConnectionHandle | null = null
    let stderrBaseline = ''
    try {
      handle = await cached.handlePromise
      stderrBaseline = handle.getStderr()
      return await fn(handle.connection)
    } catch (error) {
      const stderr = handle ? readAppServerStderrSince(handle, stderrBaseline) : ''
      if (stderr) {
        await this.closeAppServerConnection(projectPath)
        throwAppServerRequestError(error, stderr)
      }
      throw error
    } finally {
      cached.inFlight = Math.max(0, cached.inFlight - 1)
      this.scheduleAppServerConnectionClose(projectPath, cached)
    }
  }

  private async fetchModelsFromAppServer(projectPath: string, auth: CodexProjectAuth, apiProviderId?: string | null): Promise<ModelOption[]> {
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
      log.info('[codex] listModels: app-server models=%s', JSON.stringify(mapped))
      return mapped
    }, apiProviderId)
  }

  private async fetchModelsFromCustomProvider(apiProviderId?: string | null): Promise<ModelOption[]> {
    const resolved = resolveChatService('codex', apiProviderId ?? null)
    const baseUrl = resolved?.baseUrl.trim()
    if (!resolved || !baseUrl || !resolved.apiKey) {
      throw new Error('Custom Codex provider requires a base URL and API key')
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CUSTOM_PROVIDER_MODELS_TIMEOUT_MS)
    const url = modelsUrl('openai', baseUrl)
    try {
      const response = await fetch(url, {
        headers: authHeaders('openai', resolved.apiKey),
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`Custom Codex provider models request failed with HTTP ${response.status}`)
      }
      const payload = await response.json()
      log.debug('[codex] custom provider models response provider=%s status=%d payload=%s', resolved.credentialId, response.status, JSON.stringify(payload))
      const models = modelOptionsFromOpenAiList(payload, resolved.platformId)
      if (!models) {
        throw new Error('Custom Codex provider returned an invalid models response')
      }
      log.info('[codex] custom provider models fetched provider=%s count=%d', resolved.credentialId, models.length)
      return models
    } catch (error) {
      const message = error instanceof Error
        ? error.name === 'AbortError'
          ? `timed out after ${CUSTOM_PROVIDER_MODELS_TIMEOUT_MS}ms`
          : error.message
        : String(error)
      throw new Error(`Custom Codex provider models request failed: ${message}`)
    } finally {
      clearTimeout(timer)
    }
  }

  async listModels(projectPath: string, apiProviderId: string | null = null, force = false): Promise<ModelOption[]> {
    const auth = this.getProjectAuth(projectPath)
    const sig = modelCacheSignature(auth, apiProviderId)
    if (!force) {
      const cached = this.modelCacheByProvider.get(sig)
      if (cached && cached.expiresAt > Date.now()) {
        log.info('[codex] listModels: cache hit key=%s count=%d', sig, cached.models.length)
        return cached.models
      }
    }
    log.info('[codex] listModels: mode=%s, hasApiKey=%s providerSig=%s', auth.mode, Boolean(auth.apiKey || process.env.CODEX_API_KEY), sig || 'default')
    const models = getCodexProviderOverrideFor(apiProviderId)
      ? await this.fetchModelsFromCustomProvider(apiProviderId)
      : await this.fetchModelsFromAppServer(projectPath, auth, apiProviderId)
    log.info('[codex] listModels: fetched %d models', models.length)
    this.modelCacheByProvider.set(sig, { models, expiresAt: Date.now() + MODEL_CACHE_TTL_MS })
    return models
  }

  handleProviderChanged(invalidateModelCache = true): void {
    if (invalidateModelCache) this.modelCacheByProvider.clear()
    clearCodexProxyCache()
    for (const projectPath of [...this.appServerConnections.keys()]) {
      void this.closeAppServerConnection(projectPath)
    }
  }

  async withAppServerRequest<T>(
    projectPath: string,
    fn: (request: AppServerConnection['request']) => Promise<T>,
    apiProviderId: string | null = null,
  ): Promise<T> {
    const auth = this.getProjectAuth(projectPath)
    return this.withAppServerConnection(
      projectPath,
      auth,
      undefined,
      async (connection) => fn(connection.request),
      apiProviderId,
    )
  }

  /**
   * Run a stateful app-server operation on a disposable connection.
   *
   * Some RPCs such as `thread/fork` attach the returned thread to the serving
   * process and retain its persistence writer. Keeping that process in the
   * metadata pool prevents the forked session from resuming on its own
   * app-server until the pool's idle timeout expires.
   */
  async withEphemeralAppServerRequest<T>(
    projectPath: string,
    fn: (request: AppServerConnection['request']) => Promise<T>,
  ): Promise<T> {
    const auth = this.getProjectAuth(projectPath)
    const handle = await createAppServerConnection(auth)
    const stderrBaseline = handle.getStderr()
    try {
      return await fn(handle.connection.request)
    } catch (error) {
      const stderr = readAppServerStderrSince(handle, stderrBaseline)
      if (!stderr) throw error
      throwAppServerRequestError(error, stderr)
    } finally {
      await closeEphemeralAppServer(handle)
    }
  }

  async getRateLimits(projectPath: string, apiProviderId: string | null = null): Promise<CodexRateLimits | null> {
    const auth = this.getProjectAuth(projectPath)
    if (resolveMode(auth.mode, auth.apiKey) !== 'chatgpt') return null
    if (getCodexProviderOverrideFor(apiProviderId)) return null
    try {
      return await this.withAppServerConnection(projectPath, auth, undefined, async (connection) => {
        const result = await connection.request('account/rateLimits/read')
        return parseRateLimits(result)
      }, apiProviderId)
    } catch (error) {
      log.info('[codex] getRateLimits failed project=%s: %s', projectPath, error instanceof Error ? error.message : String(error))
      return null
    }
  }

  async consumeRateLimitReset(projectPath: string, apiProviderId: string | null = null, creditId?: string | null): Promise<CodexRateLimitResetOutcome | null> {
    const auth = this.getProjectAuth(projectPath)
    if (resolveMode(auth.mode, auth.apiKey) !== 'chatgpt') return null
    if (getCodexProviderOverrideFor(apiProviderId)) return null
    try {
      return await this.withAppServerConnection(projectPath, auth, undefined, async (connection) => {
        const result = await connection.request('account/rateLimitResetCredit/consume', {
          idempotencyKey: randomUUID(),
          ...(creditId ? { creditId } : {}),
        })
        return parseResetOutcome(result)
      }, apiProviderId)
    } catch (error) {
      log.info('[codex] consumeRateLimitReset failed project=%s: %s', projectPath, error instanceof Error ? error.message : String(error))
      return null
    }
  }

  async loginMcpServerOauth(
    projectPath: string,
    serverName: string,
    apiProviderId: string | null = null,
    openUrl?: (url: string) => void,
    options?: CodexMcpOauthLoginOptions,
  ): Promise<CodexMcpOauthLoginResult> {
    const auth = this.getProjectAuth(projectPath)
    try {
      return await this.withAppServerConnection(projectPath, auth, undefined, async (connection) => {
        const res = await connection.request('mcpServer/oauth/login', compactRecord({
          name: serverName,
          clientRegistration: options?.clientRegistration,
          threadId: options?.threadId,
          scopes: options?.scopes,
          timeoutSecs: options?.timeoutSecs,
        }))
        const authorizationUrl = readString(res.authorizationUrl)
        if (!authorizationUrl) return { success: false, error: 'Codex returned no authorization URL' }
        openUrl?.(authorizationUrl)
        const timeoutMs = typeof options?.timeoutSecs === 'number' && options.timeoutSecs > 0
          ? options.timeoutSecs * 1_000
          : 180_000
        const deadline = Date.now() + timeoutMs
        while (Date.now() < deadline) {
          const notif = connection.pollNotification
            ? await connection.pollNotification(Math.min(1_000, deadline - Date.now()))
            : await connection.nextNotification()
          if (!notif) continue
          if (
            notif.method === 'mcpServer/oauthLogin/completed'
            && readString(notif.params.name) === serverName
            && (!options?.threadId || readString(notif.params.threadId) === options.threadId)
          ) {
            return { success: readBoolean(notif.params.success) ?? false, error: readString(notif.params.error) ?? undefined }
          }
        }
        return { success: false, error: 'Timed out waiting for authorization' }
      }, apiProviderId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.info('[codex] loginMcpServerOauth failed project=%s server=%s: %s', projectPath, serverName, message)
      return { success: false, error: message }
    }
  }

  async detectExternalAgentConfig(projectPath: string, apiProviderId: string | null = null): Promise<CodexExternalAgentItem[]> {
    const auth = this.getProjectAuth(projectPath)
    try {
      return await this.withAppServerConnection(projectPath, auth, undefined, async (connection) => {
        const res = await connection.request('externalAgentConfig/detect', { includeHome: true, cwds: [projectPath] })
        const items = Array.isArray(res.items) ? res.items : []
        return items.map(parseExternalAgentItem).filter((i): i is CodexExternalAgentItem => i !== null)
      }, apiProviderId)
    } catch (error) {
      log.info('[codex] detectExternalAgentConfig failed project=%s: %s', projectPath, error instanceof Error ? error.message : String(error))
      return []
    }
  }

  async importExternalAgentConfig(
    projectPath: string,
    items: CodexExternalAgentItem[],
    apiProviderId: string | null = null,
  ): Promise<CodexExternalAgentImportResult | null> {
    if (items.length === 0) return { successCount: 0, failureCount: 0 }
    const auth = this.getProjectAuth(projectPath)
    try {
      return await this.withAppServerConnection(projectPath, auth, undefined, async (connection) => {
        const res = await connection.request('externalAgentConfig/import', { migrationItems: items, source: 'superone' })
        const importId = readString(res.importId)
        const deadline = Date.now() + 120_000
        while (Date.now() < deadline) {
          const notif = connection.pollNotification
            ? await connection.pollNotification(Math.min(1_000, deadline - Date.now()))
            : await connection.nextNotification()
          if (!notif) continue
          if (notif.method === 'externalAgentConfig/import/completed' && (!importId || readString(notif.params.importId) === importId)) {
            return summarizeImportResults(notif.params.itemTypeResults)
          }
        }
        return { successCount: 0, failureCount: 0 }
      }, apiProviderId)
    } catch (error) {
      log.info('[codex] importExternalAgentConfig failed project=%s: %s', projectPath, error instanceof Error ? error.message : String(error))
      return null
    }
  }

  async getAccountUsage(projectPath: string, apiProviderId: string | null = null, threadId?: string | null): Promise<CodexAccountUsage | null> {
    const auth = this.getProjectAuth(projectPath)
    if (resolveMode(auth.mode, auth.apiKey) !== 'chatgpt') return null
    if (getCodexProviderOverrideFor(apiProviderId)) return null
    try {
      return await this.withAppServerConnection(projectPath, auth, undefined, async (connection) => {
        const result = await connection.request('account/usage/read', threadId ? { threadId } : {})
        return parseAccountUsage(result)
      }, apiProviderId)
    } catch (error) {
      log.info('[codex] getAccountUsage failed project=%s: %s', projectPath, error instanceof Error ? error.message : String(error))
      return null
    }
  }

  async getServerDiagnostics(projectPath: string, apiProviderId: string | null = null): Promise<CodexServerDiagnostics | null> {
    try {
      return await this.withAppServerRequest(projectPath, async (request) => readCodexServerDiagnostics({ request }), apiProviderId)
    } catch (error) {
      log.info('[codex] server/diagnostics failed project=%s: %s', projectPath, error instanceof Error ? error.message : String(error))
      return null
    }
  }

  async getConfigRequirements(projectPath: string, apiProviderId: string | null = null): Promise<CodexConfigRequirements | null> {
    try {
      return await this.withAppServerRequest(projectPath, async (request) => readCodexConfigRequirements({ request }), apiProviderId)
    } catch (error) {
      log.info('[codex] configRequirements/read failed project=%s: %s', projectPath, error instanceof Error ? error.message : String(error))
      return null
    }
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
    for (const pending of this.pendingAccountLogins.values()) {
      void pending.handle.close().catch(() => {})
    }
    this.pendingAccountLogins.clear()
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
