import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { client, methods, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { shell } from 'electron'
import type {
  AntigravityAuthConfig,
  AntigravityAuthRequest,
  AntigravityAuthState,
} from '@superone/shared/antigravity-auth'
import { resolveDesktopAntigravityLaunch } from '../harness/antigravity-launch'
import { probeDesktopHarness } from '../harness/service'
import { ensureShellPath } from '../shell-path'
import { resolveAcpClientVersion } from './acp-client-info'
import { spawnAcpProcess } from './acp-process'
import { ANTIGRAVITY_CLIENT_INFO } from './antigravity-protocol'
import {
  clearAntigravityOAuthToken,
  extractAntigravityAuthUrlFromStdoutLine,
  extractAntigravityAuthUrlsFromStderrChunk,
  forwardAntigravityCallbackUrl,
  isAntigravityAuthSatisfied,
  prepareAntigravitySpawnContext,
  readAntigravityAuthConfig,
  validateAntigravityOAuthUrl,
  writeAntigravityAuthConfig,
} from './antigravity-profile'

export interface AntigravityAuthConnection {
  initialize(): Promise<{ authMethods?: Array<{ id?: string }> }>
  authenticate(methodId: string): Promise<unknown>
  close(): Promise<void>
}

export interface OpenAntigravityAuthConnectionOptions {
  onAuthUrl: (rawUrl: string) => void
  customHome?: string
}

export async function openAntigravityAuthConnection(
  opts: OpenAntigravityAuthConnectionOptions,
): Promise<AntigravityAuthConnection | null> {
  await ensureShellPath()
  const launch = resolveDesktopAntigravityLaunch()
  if (!launch) return null
  const spawnCtx = prepareAntigravitySpawnContext({
    customHome: opts.customHome,
  })
  const proc = spawnAcpProcess(
    {
      agentId: 'antigravity',
      command: launch.command,
      args: launch.args,
      cwd: homedir(),
      env: spawnCtx.extraEnv,
    },
    {
      baseEnv: spawnCtx.baseEnv,
      onStdoutLine: (line) => {
        const url = extractAntigravityAuthUrlFromStdoutLine(line)
        if (url) {
          opts.onAuthUrl(url)
          return true
        }
        return false
      },
      onStderrData: (chunk) => {
        for (const url of extractAntigravityAuthUrlsFromStderrChunk(chunk)) {
          opts.onAuthUrl(url)
        }
      },
      onExit: spawnCtx.cleanup,
    },
  )
  const connection = client({ name: 'superone' }).connect(proc.stream)
  return {
    initialize: () =>
      connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: ANTIGRAVITY_CLIENT_INFO,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      }),
    authenticate: (methodId) =>
      connection.agent.request(methods.agent.authenticate, { methodId }),
    close: async () => {
      try {
        connection.close()
      } finally {
        await proc.kill()
        spawnCtx.cleanup()
      }
    },
  }
}

const isActiveStatus = (status: AntigravityAuthState['status']): boolean =>
  status === 'starting' || status === 'waiting' || status === 'verifying'

function publicAuthConfig(customHome?: string): AntigravityAuthConfig {
  const stored = readAntigravityAuthConfig(customHome)
  return {
    authMethod: stored.authMethod,
    ...(stored.gcpProject ? { gcpProject: stored.gcpProject } : {}),
    ...(stored.gcpLocation ? { gcpLocation: stored.gcpLocation } : {}),
    hasApiKey: stored.hasApiKey,
  }
}

export interface AntigravityAuthServiceDeps {
  openConnection?: (
    opts: OpenAntigravityAuthConnectionOptions,
  ) => Promise<AntigravityAuthConnection | null>
  hasRuntime?: () => boolean
  openExternal?: (url: string) => Promise<void>
  forwardCallback?: typeof forwardAntigravityCallbackUrl
  onAuthChanged?: () => void
  customHome?: string
}

export class AntigravityAuthService {
  private state: AntigravityAuthState
  private connection: AntigravityAuthConnection | null = null
  private pendingCallback: { redirectUri: string; state: string } | null = null
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly openConnection: (
    opts: OpenAntigravityAuthConnectionOptions,
  ) => Promise<AntigravityAuthConnection | null>
  private readonly hasRuntime: () => boolean
  private readonly openExternal: (url: string) => Promise<void>
  private readonly forwardCallback: typeof forwardAntigravityCallbackUrl
  private readonly onAuthChanged: () => void
  private readonly customHome?: string

  constructor(deps: AntigravityAuthServiceDeps = {}) {
    this.customHome = deps.customHome
    this.openConnection = deps.openConnection ?? openAntigravityAuthConnection
    this.hasRuntime = deps.hasRuntime ?? (() => Boolean(resolveDesktopAntigravityLaunch()))
    this.openExternal = deps.openExternal ?? ((url) => shell.openExternal(url))
    this.forwardCallback = deps.forwardCallback ?? forwardAntigravityCallbackUrl
    this.onAuthChanged =
      deps.onAuthChanged ??
      (() => {
        try {
          probeDesktopHarness('acp-antigravity')
        } catch {
          void 0
        }
      })
    this.state = this.computeIdleState()
  }

  private computeIdleState(): AntigravityAuthState {
    const stored = readAntigravityAuthConfig(this.customHome)
    const config = publicAuthConfig(this.customHome)
    if (!this.hasRuntime()) {
      return { status: 'unavailable', ...config, config }
    }
    const satisfied = isAntigravityAuthSatisfied(this.customHome)
    return {
      status: satisfied ? 'signed_in' : 'signed_out',
      ...config,
      config,
      ...(satisfied && stored.email ? { email: stored.email } : {}),
    }
  }

  async handle(request: AntigravityAuthRequest): Promise<AntigravityAuthState> {
    if (request.action === 'status') {
      if (!isActiveStatus(this.state.status)) {
        this.state = {
          ...this.computeIdleState(),
          ...(this.state.status === 'error' && this.state.error
            ? { status: 'error', error: this.state.error }
            : {}),
        }
      }
      return this.state
    }

    if (request.action === 'refresh') {
      if (isActiveStatus(this.state.status)) return this.state
      this.state = this.computeIdleState()
      this.onAuthChanged()
      return this.state
    }

    if (request.action === 'configure') {
      if (isActiveStatus(this.state.status)) {
        await this.stop()
      }
      writeAntigravityAuthConfig(
        {
          authMethod: request.authMethod,
          apiKey: request.apiKey,
          clearApiKey: request.clearApiKey,
          gcpProject: request.gcpProject,
          gcpLocation: request.gcpLocation,
        },
        this.customHome,
      )
      this.state = this.computeIdleState()
      this.onAuthChanged()
      return this.state
    }

    if (request.action === 'logout') {
      await this.stop()
      clearAntigravityOAuthToken(this.customHome)
      this.state = this.computeIdleState()
      this.onAuthChanged()
      return this.state
    }

    if (request.action === 'start') {
      if (isActiveStatus(this.state.status)) return this.state
      if (request.authMethod) {
        writeAntigravityAuthConfig({ authMethod: request.authMethod }, this.customHome)
      }
      const config = publicAuthConfig(this.customHome)
      if (!this.hasRuntime()) {
        this.state = { status: 'unavailable', ...config, config }
        return this.state
      }
      if (config.authMethod === 'gemini-api-key' || config.authMethod === 'agent-platform') {
        if (!isAntigravityAuthSatisfied(this.customHome)) {
          this.state = {
            status: 'error',
            ...config,
            config,
            error:
              config.authMethod === 'gemini-api-key'
                ? 'Enter a Gemini API key before continuing.'
                : 'Enter a Vertex AI API key or both Google Cloud project and location.',
          }
          return this.state
        }
        this.state = { status: 'signed_in', ...config, config }
        this.onAuthChanged()
        return this.state
      }
      if (config.authMethod === 'oauth-business' && (!config.gcpProject || !config.gcpLocation)) {
        this.state = {
          status: 'error',
          ...config,
          config,
          error:
            'Enter both Google Cloud project ID and location before signing in with Gemini Enterprise.',
        }
        return this.state
      }

      const generation = ++this.generation
      const loginId = randomUUID()
      this.pendingCallback = null
      this.state = { status: 'starting', loginId, ...config, config }
      this.timer = setTimeout(() => {
        if (generation !== this.generation) return
        const nextCfg = publicAuthConfig(this.customHome)
        void this.stop({
          status: 'error',
          ...nextCfg,
          config: nextCfg,
          error: 'Google OAuth login timed out. Please try again.',
        })
      }, 180_000)
      void this.runOAuthLogin(generation, loginId, config.authMethod)
      return this.state
    }

    if (!isActiveStatus(this.state.status) || request.loginId !== this.state.loginId) {
      return this.state
    }

    if (request.action === 'cancel') {
      await this.stop()
      return this.state
    }

    if (this.state.status !== 'waiting' || !this.pendingCallback) {
      throw new Error('Antigravity login is not waiting for a callback URL')
    }
    const prevAuthUrl = this.state.authUrl
    this.state = {
      ...this.state,
      status: 'verifying',
    }
    try {
      await this.forwardCallback(request.callbackUrl, this.pendingCallback)
    } catch (err) {
      this.state = {
        ...this.state,
        status: 'waiting',
        authUrl: prevAuthUrl,
        error: err instanceof Error ? err.message : String(err),
      }
      throw err
    }
    return this.state
  }

  private async runOAuthLogin(
    generation: number,
    loginId: string,
    methodId: 'oauth-personal' | 'oauth-business',
  ): Promise<void> {
    let connection: AntigravityAuthConnection | null = null
    let seenUrl = false
    const handleAuthUrl = (rawUrl: string) => {
      if (generation !== this.generation || seenUrl) return
      try {
        const validated = validateAntigravityOAuthUrl(rawUrl)
        seenUrl = true
        this.pendingCallback = {
          redirectUri: validated.redirectUri,
          state: validated.state,
        }
        const cfg = publicAuthConfig(this.customHome)
        this.state = {
          status: 'waiting',
          loginId,
          authUrl: validated.authUrl,
          ...cfg,
          config: cfg,
        }
        void this.openExternal(validated.authUrl).catch(() => undefined)
      } catch (err) {
        if (generation === this.generation) {
          const cfg = publicAuthConfig(this.customHome)
          void this.stop({
            status: 'error',
            ...cfg,
            config: cfg,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    try {
      connection = await this.openConnection({
        onAuthUrl: handleAuthUrl,
        customHome: this.customHome,
      })
      if (generation !== this.generation) return
      if (!connection) {
        const cfg = publicAuthConfig(this.customHome)
        this.state = { status: 'unavailable', ...cfg, config: cfg }
        return
      }
      this.connection = connection
      await connection.initialize()
      if (generation !== this.generation) return
      await connection.authenticate(methodId)
      if (generation !== this.generation) return
      const cfg = publicAuthConfig(this.customHome)
      this.state = {
        status: 'signed_in',
        ...cfg,
        config: cfg,
      }
      this.onAuthChanged()
    } catch (err) {
      if (generation === this.generation) {
        const cfg = publicAuthConfig(this.customHome)
        this.state = {
          status: 'error',
          ...cfg,
          config: cfg,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    } finally {
      if (generation === this.generation) {
        clearTimeout(this.timer)
        this.pendingCallback = null
        this.connection = null
      }
      await connection?.close().catch(() => undefined)
    }
  }

  async stop(nextState?: AntigravityAuthState): Promise<void> {
    ++this.generation
    clearTimeout(this.timer)
    this.pendingCallback = null
    const conn = this.connection
    this.connection = null
    this.state = nextState ?? this.computeIdleState()
    await conn?.close().catch(() => undefined)
  }
}
