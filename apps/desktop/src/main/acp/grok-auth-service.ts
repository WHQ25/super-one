import { randomUUID } from 'node:crypto'
import type { GrokAuthRequest, GrokAuthState } from '@superone/shared/grok-auth'
import { isInteractiveAcpAuthMethod, pickNonInteractiveAcpAuthMethod } from './acp-auth'
import { authenticateGrokInteractively, type GrokLoginAnswer } from './acp-interactive-auth'
import { openGrokAuthConnection, type GrokAuthConnection } from './grok-auth-connection'

const active = (state: GrokAuthState) => ['starting', 'waiting', 'verifying'].includes(state.status)

export class GrokAuthService {
  private state: GrokAuthState = { status: 'signed_out' }
  private connection: GrokAuthConnection | null = null
  private answer: ((answer: GrokLoginAnswer) => void) | null = null
  private refreshPromise: Promise<GrokAuthState> | null = null
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private open = openGrokAuthConnection) {}

  async handle(request: GrokAuthRequest): Promise<GrokAuthState> {
    if (request.action === 'status') return this.state
    if (request.action === 'refresh') return this.refresh()
    if (request.action === 'start') {
      if (active(this.state)) return this.state
      if (this.refreshPromise) await this.refreshPromise
      if (active(this.state)) return this.state
      const generation = ++this.generation
      const loginId = randomUUID()
      this.state = { status: 'starting', loginId }
      this.timer = setTimeout(() => {
        if (generation !== this.generation) return
        void this.stop({ status: 'error', error: 'Login timed out. Please try again.' })
      }, 180_000)
      void this.login(generation, loginId)
      return this.state
    }
    if (!active(this.state) || request.loginId !== this.state.loginId) return this.state
    if (request.action === 'cancel') {
      await this.stop({ status: 'signed_out' })
      return this.state
    }
    const code = request.code.trim()
    if (!code || code.length > 4096) throw new Error('Enter a valid login code')
    if (!this.answer || this.state.status !== 'waiting') throw new Error('Login is not waiting for a code')
    this.state = { ...this.state, status: 'verifying' }
    this.answer({ kind: 'code', code })
    this.answer = null
    return this.state
  }

  private async account(connection: GrokAuthConnection, method?: string): Promise<GrokAuthState> {
    let info: Record<string, unknown> = {}
    try { info = await connection.request('x.ai/auth/info', {}) as Record<string, unknown> } catch { /* older CLI */ }
    return {
      status: 'signed_in', method,
      ...(typeof info?.email === 'string' ? { email: info.email } : {}),
    }
  }

  private refresh(): Promise<GrokAuthState> {
    if (active(this.state)) return Promise.resolve(this.state)
    if (this.refreshPromise) return this.refreshPromise
    const generation = this.generation
    this.refreshPromise = (async () => {
      let connection: GrokAuthConnection | null = null
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        connection = await this.open()
        if (!connection) {
          if (generation === this.generation) this.state = { status: 'unavailable' }
          return this.state
        }
        const current = connection
        const state = await Promise.race([
          (async (): Promise<GrokAuthState> => {
            const init = await current.initialize()
            const method = pickNonInteractiveAcpAuthMethod(init.authMethods ?? [])
            // Read credential availability without launching interactive authentication.
            return method ? this.account(current, method) : { status: 'signed_out' }
          })(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Could not read Grok Build account status')), 15_000) }),
        ])
        if (generation === this.generation) this.state = state
      } catch (error) {
        if (generation === this.generation) this.state = { status: 'error', error: String(error instanceof Error ? error.message : error) }
      } finally {
        clearTimeout(timer)
        await connection?.close().catch(() => {})
        this.refreshPromise = null
      }
      return this.state
    })()
    return this.refreshPromise
  }

  private async login(generation: number, loginId: string): Promise<void> {
    let connection: GrokAuthConnection | null = null
    try {
      connection = await this.open()
      if (generation !== this.generation) return
      if (!connection) { this.state = { status: 'unavailable' }; return }
      this.connection = connection
      const init = await connection.initialize()
      if (generation !== this.generation) return
      const methodId = init.authMethods?.find((method) => isInteractiveAcpAuthMethod(method.id))?.id
      if (!methodId) throw new Error('This Grok Build configuration does not offer browser login. Sign in with Grok Build, then refresh.')
      const current = connection
      await authenticateGrokInteractively({
        authenticate: () => current.request('authenticate', { methodId, _meta: { force_interactive: true } }),
        getUrl: () => current.request('x.ai/auth/get_url', {}),
        submitCode: (code) => current.request('x.ai/auth/submit_code', { code }),
        cancel: () => current.request('x.ai/auth/cancel', {}),
        request: ({ authUrl, mode }) => {
          const url = new URL(authUrl)
          if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid Grok login URL')
          if (generation !== this.generation) return Promise.resolve({ kind: 'cancel' })
          this.state = { status: 'waiting', loginId, authUrl, mode }
          return new Promise((resolve) => { this.answer = resolve })
        },
      })
      const state = await this.account(connection, methodId)
      if (generation === this.generation) this.state = state
    } catch (error) {
      if (generation === this.generation) this.state = { status: 'error', error: error instanceof Error ? error.message : String(error) }
    } finally {
      if (generation === this.generation) {
        clearTimeout(this.timer)
        this.answer = null
        this.connection = null
      }
      await connection?.close().catch(() => {})
    }
  }

  async stop(state: GrokAuthState = { status: 'signed_out' }): Promise<void> {
    ++this.generation
    clearTimeout(this.timer)
    this.state = state
    this.answer?.({ kind: 'cancel' })
    this.answer = null
    const connection = this.connection
    this.connection = null
    // Closing the owned process also cancels loopback/device polling.
    await connection?.close().catch(() => {})
  }
}
