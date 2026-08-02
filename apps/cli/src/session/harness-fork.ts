/**
 * Node harness-level transcript/thread fork (Claude SDK + Codex App Server).
 * Used by RPC `session.fork` so remote forks continue with real provider resume.
 */

import { forkClaudeTranscript } from '@superone/claude'
import { forkCodexThread, openCodexAppServer } from '@superone/codex'
import type { NodeSessionRecord } from '@superone/runtime/session'
import type { HarnessManager } from './harness-manager'
import type { ProviderStore } from '../provider/provider-store'
import { buildHarnessEnv, resolveHarnessService } from '../provider/resolve-service'
import {
  formatClaudeSessionResume,
  parseClaudeSessionResume,
} from './claude-turn-runner'
import { resolveCodexBinaryPath } from './codex-turn-runner'

export interface NodeHarnessForkOptions {
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
    const providerEnv = opts.providers
      ? buildHarnessEnv('codex', resolveHarnessService(opts.providers, 'codex', null))
      : {}
    const openFn = opts.openCodexFn ?? openCodexAppServer
    const client = await openFn({
      binaryPath: binary,
      env: { ...process.env, ...opts.env, ...providerEnv },
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

  // ACP / OpenCode / unknown: UI transcript only until harness packages expose fork.
  return null
}
