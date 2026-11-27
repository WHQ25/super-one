import { randomUUID } from 'node:crypto'
import { shell } from 'electron'
import type {
  AntigravityAccountsSnapshot,
  AntigravityActiveLogin,
  AntigravityAuthMethod,
  AntigravityAuthRequest,
} from '@superone/shared/antigravity-auth'
import { resolveDesktopAntigravityLaunch } from '../harness/antigravity-launch'
import { probeDesktopHarness } from '../harness/service'
import {
  openAntigravityAuthConnection,
  startAntigravityCodeLoginProcess,
  type AntigravityAuthConnection,
  type AntigravityCodeLoginHandle,
  type OpenAntigravityAuthConnectionOptions,
  type StartAntigravityCodeLoginOptions,
} from './antigravity-auth-transport'
import {
  antigravityAccountStore,
  forwardAntigravityCallbackUrl,
  isAccountAuthSatisfied,
  validateAntigravityLoginCodeResponse,
  validateAntigravityOAuthUrl,
} from './antigravity-profile'

export type {
  AntigravityAuthConnection,
  AntigravityCodeLoginHandle,
  OpenAntigravityAuthConnectionOptions,
  StartAntigravityCodeLoginOptions,
}
export { openAntigravityAuthConnection, startAntigravityCodeLoginProcess }

export interface AntigravityAuthServiceDeps {
  openConnection?: (
    opts: OpenAntigravityAuthConnectionOptions,
  ) => Promise<AntigravityAuthConnection | null>
  startCodeLogin?: (
    opts: StartAntigravityCodeLoginOptions,
  ) => Promise<AntigravityCodeLoginHandle | null>
  hasRuntime?: () => boolean
  openExternal?: (url: string) => Promise<void>
  forwardCallback?: typeof forwardAntigravityCallbackUrl
  onAuthChanged?: () => void
  customHome?: string
}

export class AntigravityAuthService {
  private activeLogin: AntigravityActiveLogin | null = null
  private lastError: string | undefined
  private connection: AntigravityAuthConnection | null = null
  private codeHandle: AntigravityCodeLoginHandle | null = null
  private pendingOAuth: { redirectUri: string; state: string; mode: 'code' | 'loopback' } | null = null
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly openConnection: (
    opts: OpenAntigravityAuthConnectionOptions,
  ) => Promise<AntigravityAuthConnection | null>
  private readonly startCodeLogin: (
    opts: StartAntigravityCodeLoginOptions,
  ) => Promise<AntigravityCodeLoginHandle | null>
  private readonly hasRuntime: () => boolean
  private readonly openExternal: (url: string) => Promise<void>
  private readonly forwardCallback: typeof forwardAntigravityCallbackUrl
  private readonly onAuthChanged: () => void
  private readonly customHome?: string

  constructor(deps: AntigravityAuthServiceDeps = {}) {
    this.customHome = deps.customHome
    this.openConnection = deps.openConnection ?? openAntigravityAuthConnection
    this.startCodeLogin = deps.startCodeLogin ?? startAntigravityCodeLoginProcess
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
  }

  private snapshot(): AntigravityAccountsSnapshot {
    const store = antigravityAccountStore(this.customHome)
    return {
      runtimeAvailable: this.hasRuntime(),
      defaultAccountId: store.defaultAccountId(),
      accounts: store.list(),
      activeLogin: this.activeLogin,
      ...(this.lastError ? { error: this.lastError } : {}),
    }
  }

  async handle(request: AntigravityAuthRequest): Promise<AntigravityAccountsSnapshot> {
    const store = antigravityAccountStore(this.customHome)

    if (request.action === 'list') return this.snapshot()
    if (request.action === 'refresh') {
      this.lastError = undefined
      this.onAuthChanged()
      return this.snapshot()
    }
    if (request.action === 'create') {
      this.lastError = undefined
      store.create({
        label: request.label,
        authMethod: request.authMethod,
        apiKey: request.apiKey,
        gcpProject: request.gcpProject,
        gcpLocation: request.gcpLocation,
      })
      this.onAuthChanged()
      return this.snapshot()
    }
    if (request.action === 'configure') {
      this.lastError = undefined
      if (this.activeLogin?.accountId === request.accountId) await this.stopLogin()
      store.configure({
        accountId: request.accountId,
        label: request.label,
        authMethod: request.authMethod,
        apiKey: request.apiKey,
        clearApiKey: request.clearApiKey,
        gcpProject: request.gcpProject,
        gcpLocation: request.gcpLocation,
      })
      this.onAuthChanged()
      return this.snapshot()
    }
    if (request.action === 'setDefault') {
      this.lastError = undefined
      store.setDefault(request.accountId)
      this.onAuthChanged()
      return this.snapshot()
    }
    if (request.action === 'logout') {
      this.lastError = undefined
      if (this.activeLogin?.accountId === request.accountId) await this.stopLogin()
      await this.tryNativeLogout(request.accountId)
      store.clearOAuthCredentials(request.accountId)
      this.onAuthChanged()
      return this.snapshot()
    }
    if (request.action === 'remove') {
      this.lastError = undefined
      if (this.activeLogin?.accountId === request.accountId) await this.stopLogin()
      store.remove(request.accountId)
      this.onAuthChanged()
      return this.snapshot()
    }
    if (request.action === 'startLogin') {
      return this.handleStartLogin(request.accountId, request.authMethod)
    }
    if (!this.activeLogin || request.loginId !== this.activeLogin.loginId) {
      return this.snapshot()
    }
    if (request.action === 'cancelLogin') {
      await this.stopLogin()
      return this.snapshot()
    }
    if (this.activeLogin.status !== 'waiting' || !this.pendingOAuth) {
      throw new Error('Antigravity login is not waiting for a response')
    }
    if (this.pendingOAuth.mode === 'code') {
      const validated = validateAntigravityLoginCodeResponse(this.pendingOAuth, request.response)
      if (!validated) {
        throw new Error('Paste the authorization code or callback URL from the Google sign-in page.')
      }
      this.activeLogin = { ...this.activeLogin, status: 'verifying' }
      this.codeHandle?.submit(validated)
      return this.snapshot()
    }
    const prevLogin = this.activeLogin
    this.activeLogin = { ...prevLogin, status: 'verifying' }
    try {
      await this.forwardCallback(request.response, this.pendingOAuth)
    } catch (err) {
      this.activeLogin = prevLogin
      throw err
    }
    return this.snapshot()
  }

  private async handleStartLogin(
    accountId: string,
    overrideMethod?: AntigravityAuthMethod,
  ): Promise<AntigravityAccountsSnapshot> {
    if (this.activeLogin) return this.snapshot()
    const store = antigravityAccountStore(this.customHome)
    this.lastError = undefined
    if (!store.has(accountId)) throw new Error(`Unknown Antigravity account: ${accountId}`)
    if (overrideMethod) store.configure({ accountId, authMethod: overrideMethod })
    const account = store.get(accountId)
    if (!this.hasRuntime()) {
      this.lastError = 'Antigravity CLI (agy) is not installed.'
      return this.snapshot()
    }
    if (account.authMethod === 'gemini-api-key' || account.authMethod === 'agent-platform') {
      if (!isAccountAuthSatisfied(account, this.customHome)) {
        this.lastError =
          account.authMethod === 'gemini-api-key'
            ? 'Enter a Gemini API key before continuing.'
            : 'Enter a Vertex AI API key or both Google Cloud project and location.'
        return this.snapshot()
      }
      this.onAuthChanged()
      return this.snapshot()
    }
    if (account.authMethod === 'oauth-business' && (!account.gcpProject || !account.gcpLocation)) {
      this.lastError =
        'Enter both Google Cloud project ID and location before signing in with Gemini Enterprise.'
      return this.snapshot()
    }

    const generation = ++this.generation
    const loginId = randomUUID()
    const useCodeLogin = account.profileDir !== null && account.authMethod === 'oauth-personal'
    this.pendingOAuth = null
    this.activeLogin = {
      accountId: account.id,
      loginId,
      status: 'starting',
      authMethod: account.authMethod,
      mode: useCodeLogin ? 'code' : 'loopback',
    }
    this.timer = setTimeout(() => {
      if (generation !== this.generation) return
      void this.stopLogin('Google OAuth login timed out. Please try again.')
    }, 300_000)

    if (useCodeLogin) void this.runCodeLogin(generation, loginId, account.id)
    else void this.runLoopbackLogin(generation, loginId, account.id, account.authMethod)
    return this.snapshot()
  }

  private async tryNativeLogout(accountId: string): Promise<void> {
    if (!this.hasRuntime()) return
    let conn: AntigravityAuthConnection | null = null
    try {
      conn = await this.openConnection({
        accountId,
        onAuthUrl: () => {},
        customHome: this.customHome,
      })
      if (!conn) return
      const init = await Promise.race([
        conn.initialize(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
      ])
      if (init?.agentCapabilities?.auth?.logout && conn.logout) {
        await Promise.race([
          conn.logout(),
          new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
        ])
      }
    } catch {
      void 0
    } finally {
      await conn?.close().catch(() => undefined)
    }
  }

  private async runCodeLogin(
    generation: number,
    loginId: string,
    accountId: string,
  ): Promise<void> {
    let handle: AntigravityCodeLoginHandle | null = null
    let seenUrl = false
    const handleAuthUrl = (rawUrl: string) => {
      if (generation !== this.generation || seenUrl) return
      try {
        const validated = validateAntigravityOAuthUrl(rawUrl, 'code')
        seenUrl = true
        this.pendingOAuth = {
          redirectUri: validated.redirectUri,
          state: validated.state,
          mode: 'code',
        }
        this.activeLogin = {
          accountId,
          loginId,
          status: 'waiting',
          authMethod: 'oauth-personal',
          mode: 'code',
          authUrl: validated.authUrl,
        }
        void this.openExternal(validated.authUrl).catch(() => undefined)
      } catch (err) {
        if (generation === this.generation) {
          void this.stopLogin(err instanceof Error ? err.message : String(err))
        }
      }
    }

    try {
      handle = await this.startCodeLogin({
        accountId,
        onAuthUrl: handleAuthUrl,
        customHome: this.customHome,
      })
      if (generation !== this.generation) return
      if (!handle) {
        this.lastError = 'Antigravity CLI (agy) is not installed.'
        return
      }
      this.codeHandle = handle
      await handle.completed
      if (generation !== this.generation) return
      antigravityAccountStore(this.customHome).configure({
        accountId,
        authMethod: 'oauth-personal',
        oauthSignedIn: true,
      })
      this.lastError = undefined
      this.onAuthChanged()
    } catch (err) {
      if (generation === this.generation) {
        this.lastError = err instanceof Error ? err.message : String(err)
      }
    } finally {
      if (generation === this.generation) {
        clearTimeout(this.timer)
        this.timer = undefined
        this.pendingOAuth = null
        this.codeHandle = null
        this.activeLogin = null
      }
      await handle?.close().catch(() => undefined)
    }
  }

  private async runLoopbackLogin(
    generation: number,
    loginId: string,
    accountId: string,
    methodId: 'oauth-personal' | 'oauth-business',
  ): Promise<void> {
    let connection: AntigravityAuthConnection | null = null
    let seenUrl = false
    const handleAuthUrl = (rawUrl: string) => {
      if (generation !== this.generation || seenUrl) return
      try {
        const validated = validateAntigravityOAuthUrl(rawUrl, 'loopback')
        seenUrl = true
        this.pendingOAuth = {
          redirectUri: validated.redirectUri,
          state: validated.state,
          mode: 'loopback',
        }
        this.activeLogin = {
          accountId,
          loginId,
          status: 'waiting',
          authMethod: methodId,
          mode: 'loopback',
          authUrl: validated.authUrl,
        }
        void this.openExternal(validated.authUrl).catch(() => undefined)
      } catch (err) {
        if (generation === this.generation) {
          void this.stopLogin(err instanceof Error ? err.message : String(err))
        }
      }
    }

    try {
      connection = await this.openConnection({
        accountId,
        onAuthUrl: handleAuthUrl,
        customHome: this.customHome,
      })
      if (generation !== this.generation) return
      if (!connection) {
        this.lastError = 'Antigravity CLI (agy) is not installed.'
        return
      }
      this.connection = connection
      await connection.initialize()
      if (generation !== this.generation) return
      await connection.authenticate(methodId)
      if (generation !== this.generation) return
      antigravityAccountStore(this.customHome).configure({
        accountId,
        authMethod: methodId,
        oauthSignedIn: true,
      })
      this.lastError = undefined
      this.onAuthChanged()
    } catch (err) {
      if (generation === this.generation) {
        this.lastError = err instanceof Error ? err.message : String(err)
      }
    } finally {
      if (generation === this.generation) {
        clearTimeout(this.timer)
        this.timer = undefined
        this.pendingOAuth = null
        this.connection = null
        this.activeLogin = null
      }
      await connection?.close().catch(() => undefined)
    }
  }

  async stopLogin(error?: string): Promise<void> {
    ++this.generation
    clearTimeout(this.timer)
    this.timer = undefined
    this.pendingOAuth = null
    this.activeLogin = null
    if (error !== undefined) this.lastError = error
    const conn = this.connection
    this.connection = null
    const handle = this.codeHandle
    this.codeHandle = null
    await Promise.all([
      conn?.close().catch(() => undefined),
      handle?.close().catch(() => undefined),
    ])
  }
}
