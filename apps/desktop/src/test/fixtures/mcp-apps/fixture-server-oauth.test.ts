import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { startFixtureHttpServer, type FixtureHttpServer } from './fixture-server'

const REDIRECT = 'http://127.0.0.1:1/callback'

/** A headless OAuth client: "opening" the authorization URL just reads the auto-approved redirect. */
function headlessAuth() {
  let client: OAuthClientInformationMixed | undefined
  let tokens: OAuthTokens | undefined
  let verifier = ''
  let code: string | undefined
  const provider: OAuthClientProvider = {
    redirectUrl: REDIRECT,
    clientMetadata: { client_name: 'fixture-test', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' },
    clientInformation: () => client,
    saveClientInformation: (info) => { client = info },
    tokens: () => tokens,
    saveTokens: (t) => { tokens = t },
    saveCodeVerifier: (v) => { verifier = v },
    codeVerifier: () => verifier,
    redirectToAuthorization: async (url) => {
      const res = await fetch(url, { redirect: 'manual' })
      code = new URL(res.headers.get('location')!).searchParams.get('code') ?? undefined
    },
  }
  return { provider, code: () => code, tokens: () => tokens }
}

let server: FixtureHttpServer | undefined
afterEach(async () => { await server?.close(); server = undefined })

describe('MCP Apps fixture server with OAuth', () => {
  it('rejects unauthenticated clients with a discoverable challenge', async () => {
    server = await startFixtureHttpServer({ oauth: true })
    const res = await fetch(server.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(401)
    const challenge = res.headers.get('www-authenticate') ?? ''
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1]
    expect(await (await fetch(metadataUrl!)).json()).toMatchObject({ authorization_servers: [server.issuer] })
  })

  it('completes discovery, registration, PKCE and token exchange, then serves tools', async () => {
    server = await startFixtureHttpServer({ oauth: true })
    const auth = headlessAuth()
    const first = new StreamableHTTPClientTransport(new URL(server.url), { authProvider: auth.provider })
    await expect(new Client({ name: 't', version: '1' }).connect(first)).rejects.toBeInstanceOf(UnauthorizedError)
    await first.finishAuth(auth.code()!)
    expect(auth.tokens()?.access_token).toBeTruthy()

    const client = new Client({ name: 't', version: '1' })
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { authProvider: auth.provider }))
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('fixture_list_items')
    await client.close()
  })
})
