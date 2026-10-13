import { isCodexAccountProvider } from '@superone/shared/codex-accounts'
import { nodeCodexAccountStore } from './codex-accounts'
/**
 * Node harness-level transcript/thread fork (Claude SDK + Codex App Server).
 * Used by RPC `session.fork` so remote forks continue with real provider resume.
 */

import { forkClaudeTranscript } from '@superone/claude'
import { forkCodexThread, openCodexAppServer } from '@superone/codex'
import type { NodeSessionRecord } from '@superone/runtime/session'
import type { HarnessManager } from './harness-manager'
import type { ProviderStore } from '../provider/provider-store'
import { buildHarnessEnvWithProxy, resolveHarnessService } from '../provider/resolve-service'
import {
  formatClaudeSessionResume,
  parseClaudeSessionResume,
} from './claude-turn-runner'
import { resolveCodexBinaryPath } from './codex-turn-runner'
import { startOpenCodeSessionServer } from '@superone/opencode/owned-service'
import { join } from 'node:path'
import { resolveOpenCodeLaunch } from '@superone/opencode/launch'
import { OpenCodeV2Client } from '@superone/opencode/opencode-v2-client'
import { nativeForkBoundary } from '@superone/opencode/native-history'
import { resolveNodeOpenCodeProvider } from '../provider/opencode-provider'

export interface NodeHarnessForkOptions {
  nodeHome?: string
  resolveProjectPath: (projectId: string) => string | null
  harnesses?: HarnessManager
  providers?: ProviderStore
  env?: NodeJS.ProcessEnv
  /** Injectable Claude SDK fork (tests). */
  forkClaudeFn?: typeof forkClaudeTranscript
  /** Injectable Codex open (tests). */
  openCodexFn?: typeof openCodexAppServer
  /** Injectable Codex binary path (tests). */
  codexBinaryPath?: string | null
  nativeForkAnchor?: string
  assertControl?: () => void
}

/**
 * Fork the provider-side conversation for a node session.
 * Returns a new `providerResume` token, or null when the source has none
 * (UI transcript-only fork).
 *
 * Throws when the source has a resume token but harness fork fails — callers
 * should roll back worktree creation.
 */
export async function forkNodeHarnessResume(
  source: NodeSessionRecord,
  targetCwd: string,
  opts: NodeHarnessForkOptions,
  forkFromMessageId?: string,
): Promise<string | null> {
  const harnessId = (source.harnessId || source.providerId || 'claude').toLowerCase()
  const resume = source.providerResume?.trim() || null
  if (!resume) {
    // No live provider session — SessionRuntime still clones UI transcript.
    return null
  }

  if (harnessId === 'claude') {
    const sessionId = parseClaudeSessionResume(resume)
    if (!sessionId) {
      throw new Error(`Unrecognized Claude providerResume: ${resume}`)
    }
    const forkFn = opts.forkClaudeFn ?? forkClaudeTranscript
    const newSdkId = await forkFn({
      providerSessionId: sessionId,
      targetCwd,
      // Node transcript block ids are not SDK message UUIDs; full SDK copy.
      // UI truncation still applies via SessionRuntime.fork(forkFromMessageId).
      upToMessageId: undefined,
    })
    void forkFromMessageId // reserved when we persist SDK anchors on node turns
    return formatClaudeSessionResume(newSdkId)
  }

  if (harnessId === 'codex') {
    const threadId = resume.startsWith('thread:') ? resume.slice('thread:'.length).trim() : ''
    if (!threadId) {
      throw new Error(`Unrecognized Codex providerResume: ${resume}`)
    }
    const binary =
      opts.codexBinaryPath ??
      resolveCodexBinaryPath({ binaryPath: null, harnesses: opts.harnesses })
    if (!binary) {
      throw new Error(
        'Codex binary not available for thread fork: enable harness codex or set SUPERONE_CODEX_BINARY',
      )
    }
    const projectRoot =
      opts.resolveProjectPath(source.projectId) ||
      process.env.SUPERONE_DEFAULT_CWD ||
      process.cwd()
    // openai-chat → loopback proxy; native openai-responses → real base URL.
    const providerEnv = opts.providers
      ? await buildHarnessEnvWithProxy(
          'codex',
          resolveHarnessService(opts.providers, 'codex', source.apiProviderId),
        )
      : {}
    const openFn = opts.openCodexFn ?? openCodexAppServer
    const client = await openFn({
      binaryPath: binary,
      env: isCodexAccountProvider(source.apiProviderId)
        ? nodeCodexAccountStore(opts.nodeHome).environment(source.apiProviderId!, { ...process.env, ...opts.env })
        : { ...process.env, ...opts.env, ...providerEnv },
      cliArgs: isCodexAccountProvider(source.apiProviderId) ? nodeCodexAccountStore(opts.nodeHome).cliOverrides(source.apiProviderId!) : undefined,
    })
    try {
      const newThreadId = await forkCodexThread({
        request: (method, params) => client.request(method, params),
        threadId,
        // No turnId anchors on node transcript yet — full thread fork.
      })
      return `thread:${newThreadId}`
    } finally {
      await client.close().catch(() => {})
    }
  }

  if (harnessId === 'opencode') {
    const sessionID = resume.startsWith('opencode:') ? resume.slice(9) : ''
    if (!sessionID) throw new Error('Unrecognized OpenCode provider resume')
    if (forkFromMessageId && !opts.nativeForkAnchor) throw new Error('Native OpenCode fork anchor is required')
    const cwd = source.cwd || opts.resolveProjectPath(source.projectId) || process.cwd()
    const env = Object.fromEntries(Object.entries(opts.env ?? {}).filter((item): item is [string, string] => typeof item[1] === 'string'))
    const provider = resolveNodeOpenCodeProvider(opts.providers, source.apiProviderId, env)
    const launch = resolveOpenCodeLaunch({ harnesses: opts.harnesses })
    if (!launch.binaryPath && !launch.serverUrl) throw new Error('OpenCode runtime is unavailable for fork')
    opts.assertControl?.()
    const server = await startOpenCodeSessionServer({ ...launch, cwd, env: { ...env, ...provider?.env }, sessionId: source.sessionId, nativeSessionId: sessionID, admin: true,
      ...(opts.nodeHome ? { serviceHome: join(opts.nodeHome, 'opencode-services') } : {}) })
    try {
      if (server.protocol !== 'v2') throw new Error('Native OpenCode fork requires V2')
      const client = new OpenCodeV2Client({ baseUrl: server.url, password: server.password, directory: cwd })
      const messages = await client.messages(sessionID, { order: 'asc' })
      const boundary = nativeForkBoundary(messages, opts.nativeForkAnchor)
      const fork = await client.forkSession(sessionID, boundary, opts.assertControl)
      try {
        if (fork.directory !== targetCwd) await client.moveSession(fork.id, targetCwd, opts.assertControl)
        opts.assertControl?.()
        return `opencode:${fork.id}`
      } catch (error) { await client.deleteSession(fork.id).catch(() => {}); throw error }
    } finally { await server.close() }
  }

  // ACP / unknown: UI transcript only until harness packages expose fork.
  return null
}
