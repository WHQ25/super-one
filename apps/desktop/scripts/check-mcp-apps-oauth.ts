/**
 * Live sign-in check for native MCP Apps providers against the fixture's
 * auto-approving OAuth server. "Opening" the authorization page follows its
 * redirect the way a browser would. Harness credential stores are isolated in
 * temp dirs; nothing touches the user's config or keychain.
 *   bun apps/desktop/scripts/check-mcp-apps-oauth.ts
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeMcpAppsCatalog, createClaudeMcpAppsProvider, withMcpAppsHostEnv } from '@superone/claude/mcp-apps'
import { openCodexAppServer } from '@superone/codex/app-server-client'
import { createCodexMcpAppsProvider } from '@superone/codex/mcp-apps'
import { dispatchMcpAppsProviderRequest } from '@superone/runtime/mcp-apps/provider-rpc'
import type { McpAppsBinding, McpAppsProvider } from '@superone/shared/mcp-apps'
import { startFixtureHttpServer } from '../src/test/fixtures/mcp-apps/fixture-server'
import { authenticateMcpApp } from '../src/main/mcp-apps/auth'

const root = resolve(import.meta.dirname, '../../..')
const binding: McpAppsBinding = { node: 'check', session: 'check', server: 'fixture', configGeneration: 0, configFingerprint: 'fixture' }
const signal = new AbortController().signal

/** A browser: load the authorization page, follow the auto-approved redirect to the callback. */
async function browser(url: string): Promise<void> {
  const res = await fetch(url, { redirect: 'manual' })
  await fetch(res.headers.get('location')!)
}

async function exercise(label: string, makeProvider: () => McpAppsProvider, providerSessionId: string, hostCallback: boolean) {
  const origin = { providerSessionId }
  const request = (op: Record<string, unknown>) => dispatchMcpAppsProviderRequest({ binding, origin, ...op } as never, makeProvider())
  const before = await request({ operation: 'callTool', tool: 'fixture_next_page', args: { page: 2 } })
  const signIn = await authenticateMcpApp({ request, openUrl: browser, hostCallback, timeoutMs: 60_000, pollMs: 500 }, signal)
  const after = await request({ operation: 'callTool', tool: 'fixture_next_page', args: { page: 2 } })
  const verdict = {
    beforeIsAuthRequired: !before.ok && before.error.code === 'auth_required',
    signedIn: signIn.ok,
    callAfterSignIn: after.ok && (after.value as { outcome: string }).outcome === 'completed',
  }
  console.log(JSON.stringify({ kind: label, before, signIn, verdict }, null, 2))
  return Object.values(verdict).every(Boolean)
}

async function checkClaude(hostCallback: boolean): Promise<boolean> {
  const server = await startFixtureHttpServer({ oauth: true })
  const configDir = mkdtempSync(join(tmpdir(), 'superone-claude-oauth-'))
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  const q = query({
    prompt: (async function* () { await gate })() as never,
    options: {
      settingSources: [],
      env: withMcpAppsHostEnv({ ...process.env, CLAUDE_CONFIG_DIR: configDir }),
      mcpServers: { fixture: { type: 'http', url: server.url } },
    },
  })
  const catalog = new ClaudeMcpAppsCatalog()
  const load = () => q.mcpServerStatus()
  // Let the first connection attempt settle so "before" observes needs-auth, not pending.
  for (let i = 0; i < 40 && (await load()).find((s) => s.name === 'fixture')?.status === 'pending'; i++) await new Promise((r) => setTimeout(r, 250))
  try {
    return await exercise(`claude${hostCallback ? '-remote' : ''}`, () => createClaudeMcpAppsProvider(binding, {
      query: async () => q,
      providerSessionId: () => '',
      tools: async () => { await catalog.refresh(load, { force: true }); return catalog.tools('fixture') ?? new Map() },
      serverStatus: async () => { await catalog.refresh(load, { force: true }); return catalog.status('fixture') },
    }), '', hostCallback)
  } finally {
    release()
    q.close()
    await server.close()
    rmSync(configDir, { recursive: true, force: true })
  }
}

async function checkCodex(): Promise<boolean> {
  const server = await startFixtureHttpServer({ oauth: true })
  const home = mkdtempSync(join(tmpdir(), 'superone-codex-oauth-'))
  const auth = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json')
  if (existsSync(auth)) copyFileSync(auth, join(home, 'auth.json'))
  // Keep MCP tokens out of the user's keychain.
  writeFileSync(join(home, 'config.toml'), 'mcp_oauth_credentials_store = "file"\n')
  const client = await openCodexAppServer({ binaryPath: join(root, 'node_modules/.bin/codex'), env: { ...process.env, CODEX_HOME: home } })
  try {
    const start = await client.request('thread/start', { cwd: root, approvalPolicy: 'never', sandbox: 'read-only', config: { mcp_servers: { fixture: { url: server.url } } } })
    const threadId = (start.thread as { id: string }).id
    return await exercise('codex', () => createCodexMcpAppsProvider(binding, threadId, client.request.bind(client)), threadId, false)
  } finally {
    await client.close()
    await server.close()
    rmSync(home, { recursive: true, force: true })
  }
}

const results = { claude: await checkClaude(false), claudeRemoteRelay: await checkClaude(true), codex: await checkCodex() }
console.log(JSON.stringify({ kind: 'verdict', ...results }, null, 2))
if (!Object.values(results).every(Boolean)) process.exitCode = 1
