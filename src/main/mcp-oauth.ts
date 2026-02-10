import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { join } from 'path'
import { app, shell } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { auth } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'

// --- Token cache (for future refresh) ---

const OAUTH_CACHE_FILE = 'mcp-oauth-cache.json'

interface OAuthCacheEntry {
  accessToken: string
  refreshToken?: string
  expiresAt?: string
}

function getCachePath(): string {
  return join(app.getPath('userData'), OAUTH_CACHE_FILE)
}

function readOAuthCache(): Record<string, OAuthCacheEntry> {
  const filePath = getCachePath()
  if (!existsSync(filePath)) return {}
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return {}
  }
}

function writeOAuthCache(cache: Record<string, OAuthCacheEntry>): void {
  writeFileSync(getCachePath(), JSON.stringify(cache, null, 2))
}

// --- OAuthClientProvider for Electron ---

class ElectronOAuthProvider implements OAuthClientProvider {
  private _redirectUrl: string
  private _tokens?: OAuthTokens
  private _clientInfo?: OAuthClientInformationMixed
  private _codeVerifier?: string

  constructor(redirectUrl: string) {
    this._redirectUrl = redirectUrl
  }

  get redirectUrl(): string {
    return this._redirectUrl
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'SuperPM Desktop',
      redirect_uris: [this._redirectUrl],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this._clientInfo
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    this._clientInfo = info
  }

  tokens(): OAuthTokens | undefined {
    return this._tokens
  }

  saveTokens(tokens: OAuthTokens): void {
    this._tokens = tokens
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await shell.openExternal(authorizationUrl.toString())
  }

  saveCodeVerifier(codeVerifier: string): void {
    this._codeVerifier = codeVerifier
  }

  codeVerifier(): string {
    return this._codeVerifier ?? ''
  }

  getAccessToken(): string | undefined {
    return this._tokens?.access_token
  }

  getRefreshToken(): string | undefined {
    return this._tokens?.refresh_token
  }

  getExpiresIn(): number | undefined {
    return this._tokens?.expires_in
  }
}

// --- Callback server ---

async function createCallbackServer(): Promise<{
  server: Server
  port: number
  waitForCode: Promise<string>
}> {
  let resolveCode!: (code: string) => void
  let rejectCode!: (err: Error) => void

  const waitForCode = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '', 'http://127.0.0.1')

    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      if (error) {
        res.end(
          '<html><body style="font-family:system-ui;text-align:center;padding:60px">' +
          '<h2>Authorization Failed</h2>' +
          `<p style="color:#666">${error}</p>` +
          '<p style="color:#999;font-size:14px">You can close this window.</p>' +
          '</body></html>'
        )
        rejectCode(new Error(`OAuth error: ${error}`))
      } else if (code) {
        res.end(
          '<html><body style="font-family:system-ui;text-align:center;padding:60px">' +
          '<h2>Authorization Successful</h2>' +
          '<p style="color:#999;font-size:14px">You can close this window and return to SuperPM.</p>' +
          '</body></html>'
        )
        resolveCode(code)
      } else {
        res.end(
          '<html><body style="font-family:system-ui;text-align:center;padding:60px">' +
          '<h2>Error</h2><p>Missing authorization code.</p>' +
          '</body></html>'
        )
        rejectCode(new Error('Missing authorization code in callback'))
      }
    } else {
      res.writeHead(404)
      res.end()
    }
  })

  // Wait for server to start listening before reading the port
  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve(addr.port)
    })
    server.on('error', reject)
  })

  return { server, port, waitForCode }
}

// --- Main entry point ---

/**
 * Verify connectivity and attempt OAuth authorization for an HTTP MCP server.
 * Accepts existing headers (e.g. user-provided Authorization) and verifies the server is reachable.
 * Returns the final verified headers. Throws on any failure.
 */
export async function authorizeHttpMcpServer(
  serverUrl: string,
  existingHeaders: Record<string, string> = {},
  transport: 'http' | 'sse' = 'http',
): Promise<Record<string, string>> {
  const headers = { ...existingHeaders }

  // 1. Test connection with existing headers
  let needsAuth = false
  try {
    const fetchOptions: RequestInit = transport === 'sse'
      ? { method: 'GET', headers: { ...headers } }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'initialize',
            params: {
              protocolVersion: '2025-03-26',
              capabilities: {},
              clientInfo: { name: 'superpm-oauth-probe', version: '1.0.0' },
            },
            id: 1,
          }),
        }
    const response = await fetch(serverUrl, fetchOptions)
    if (response.status === 401) {
      needsAuth = true
    }
  } catch (e) {
    throw new Error(`Cannot reach MCP server: ${(e as Error).message}`)
  }

  if (!needsAuth) {
    return headers
  }

  // Server requires auth
  if (headers['Authorization']) {
    throw new Error('Server returned 401: the provided Authorization header may be invalid')
  }

  // 2. Start callback server for OAuth
  const { server, port, waitForCode } = await createCallbackServer()
  const redirectUrl = `http://127.0.0.1:${port}/callback`

  try {
    const provider = new ElectronOAuthProvider(redirectUrl)

    // 3. First pass: discover metadata, register client, redirect to authorization
    const result1 = await auth(provider, { serverUrl })

    if (result1 === 'AUTHORIZED') {
      const token = provider.getAccessToken()
      if (!token) throw new Error('OAuth completed but no access token received')
      headers['Authorization'] = `Bearer ${token}`
      return headers
    }

    // result1 === 'REDIRECT' — browser opened, wait for callback
    const code = await Promise.race([
      waitForCode,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Authorization timed out (2 minutes)')), 120_000)
      ),
    ])

    // 4. Second pass: exchange code for tokens
    const result2 = await auth(provider, { serverUrl, authorizationCode: code })

    if (result2 === 'AUTHORIZED') {
      const token = provider.getAccessToken()
      if (!token) throw new Error('OAuth completed but no access token received')

      // Cache for future refresh
      const cache = readOAuthCache()
      cache[serverUrl] = {
        accessToken: token,
        refreshToken: provider.getRefreshToken(),
        expiresAt: provider.getExpiresIn()
          ? new Date(Date.now() + provider.getExpiresIn()! * 1000).toISOString()
          : undefined,
      }
      writeOAuthCache(cache)

      headers['Authorization'] = `Bearer ${token}`
      return headers
    }

    throw new Error('OAuth authorization was not completed')
  } finally {
    server.close()
  }
}
