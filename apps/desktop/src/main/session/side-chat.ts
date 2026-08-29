/**
 * Side chat — an ephemeral branch of a live conversation, docked beside it.
 *
 * A side chat is a normal harness fork (`Harness.forkTranscript`) whose SuperOne
 * session is never written to the database. The agent keeps the parent's full
 * context; the user gets a scratch thread that vanishes with its tab. Nothing it
 * says flows back into the parent transcript.
 *
 * Only harnesses with `supportsFork` reach here — without a real transcript fork
 * the child would be a blank session pretending to remember the conversation.
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import type { HarnessId, SandboxMode, SideChatStartRequest, SideChatStartResult } from '@superone/shared/agent-types'
import log from '../logger'
import { harnessRegistry } from './harness-registry'
import { getSessionRecord } from './session-repo'
import { getSessionProvider } from './session-provider-repo'
import type { ForkContext, Session, SessionManager } from './types'

/**
 * Carried into the side chat as the first turn's preamble — NOT as a system
 * prompt append.
 *
 * The whole feature is built on fork because a fork keeps the parent's prompt
 * cache. That cache is keyed on the request prefix, and the system block is the
 * head of it: appending here would make the side chat's prefix differ from the
 * parent's at token one, so its first turn would re-read the entire copied
 * transcript uncached. Riding the first message instead leaves the prefix
 * byte-identical — see `SessionCreateOptions.firstTurnPreamble`.
 *
 * States the four things the agent cannot infer from the forked transcript: it
 * is not the main thread, the parent will never read this, the thread is about
 * to be thrown away — and, most importantly, that the work in progress it can
 * see above belongs to someone else. A fork copies the transcript verbatim, so
 * without being told, a model handed a conversation that stops mid-task will do
 * the obvious thing and resume it — in the same working directory the parent
 * session is editing right now.
 */
export const SIDE_CHAT_INSTRUCTIONS = `# Side chat

You are running as a **side chat**: a temporary branch of the conversation you can see above, opened in a small panel beside it.

## The task above is not yours

The transcript may stop in the middle of something — a plan half executed, a todo list part way down, an edit announced but not made. **That work belongs to the parent session, which is still running it.** Do not continue it, do not redo it, and do not act on any pending plan, todo, or "next I will…" you find above. You share the parent's working directory, so resuming its task would collide with edits it is making right now.

Read the transcript only as context for the user's question. Then answer that question and stop.

## What this thread is for

Quick questions about the conversation or the code: what something means, why an approach was chosen, what a piece of the codebase does, how an error should be read. Answer directly and keep it short — the panel is narrow.

Strongly prefer reading and explaining over writing. If the user asks for a change that belongs to the main task, say so and let them take it back to the parent thread instead of editing here.

## This thread is disposable

The parent session cannot see anything said here; nothing is written back to it. The whole side chat is discarded when the user closes its tab, so do not build up state, notes, or plans the user will need later.`

/**
 * `SandboxInfo` back to the `SandboxMode` `createSession` takes.
 *
 * `Session` stores the resolved pair and only ever converts forwards, so a
 * caller copying one session's sandbox onto a new one has to invert it here.
 */
function sandboxInfoToMode(info: { enabled: boolean; autoAllowBash?: boolean }): SandboxMode {
  if (!info.enabled) return 'off'
  return info.autoAllowBash ? 'auto' : 'on'
}

/**
 * Where the fork should read from.
 *
 * Prefers the live `Session` over the database row: a side chat is opened off the
 * chat the user is looking at, and that session's provider id / cwd / model can
 * be newer than anything persisted (a draft's provider id only exists in memory
 * until its first state change).
 */
function resolveSource(mgr: SessionManager, parentSessionId: string) {
  const live = mgr.getSession(parentSessionId)
  const record = getSessionRecord(parentSessionId)
  if (!live && !record) return null

  const snapshot = live?.snapshot
  const projectPath = snapshot?.projectPath ?? record!.projectPath
  const recordCwd = record?.worktreePath && existsSync(record.worktreePath)
    ? record.worktreePath
    : record?.projectPath
  return {
    live,
    projectPath,
    cwd: live?.cwd ?? recordCwd ?? projectPath,
    providerId: snapshot?.providerId ?? record!.providerId,
    providerSessionId: snapshot?.providerSessionId ?? record?.providerSessionId ?? null,
    gitBranch: snapshot?.gitBranch ?? record?.gitBranch ?? null,
    apiProviderId: snapshot?.apiProviderId ?? record?.apiProviderId ?? null,
    acpAgentId: snapshot?.acpAgentId ?? record?.acpAgentId ?? null,
    selectedModel: snapshot?.selectedModel ?? record?.selectedModel ?? null,
    selectedEffort: snapshot?.selectedEffort ?? record?.selectedEffort ?? null,
    // Permission mode and sandbox are inherited, not defaulted. A side chat runs
    // in the parent's working directory; letting it start on the process default
    // means the status bar shows the project's sandbox while the runtime was
    // built with another one — the user reads a guarantee that is not in force.
    permissionMode: live?.getCurrentPermissionMode(),
    sandboxMode: live ? sandboxInfoToMode(live.getCurrentSandboxInfo()) : undefined,
    // dsh composes its agent from a preset held in providerConfig. Without it the
    // fork resumes the parent's durable log (authoritative, so it runs the
    // parent's preset) while the picker, seeing nothing, shows the roster's first
    // entry — displayed and running disagree from the first frame.
    agentPreset: live?.getAgentPreset() ?? null,
  }
}

/**
 * Fork `parentSessionId` into an ephemeral session sharing its working directory.
 *
 * The returned session already exists in `SessionManager`, so the renderer's
 * normal send path finds it by id — no database row is ever created for it.
 */
export async function startSideChat(
  mgr: SessionManager,
  input: SideChatStartRequest,
): Promise<SideChatStartResult> {
  const source = resolveSource(mgr, input.parentSessionId)
  if (!source) return { ok: false, error: 'Parent session not found' }
  if (!source.providerSessionId) {
    return { ok: false, error: 'This session has no conversation to branch from yet' }
  }

  const provider = getSessionProvider(source.providerId)
  if (!provider) return { ok: false, error: `Session provider not found: ${source.providerId}` }
  const harness = harnessRegistry.get(provider.harnessId)
  if (!harness) return { ok: false, error: `Unknown harness: ${provider.harnessId}` }
  if (!HARNESS_CAPABILITIES[provider.harnessId].supportsFork) {
    return { ok: false, error: `${HARNESS_CAPABILITIES[provider.harnessId].displayName} cannot fork a conversation` }
  }

  // Whole conversation, no truncation: a side chat asks about where the parent is
  // now, so an empty ForkContext (full copy) is the point, not a missing feature.
  const ctx: ForkContext = { messages: [] }
  let forkedProviderSessionId: string
  try {
    forkedProviderSessionId = await harness.forkTranscript(
      {
        providerSessionId: source.providerSessionId,
        projectPath: source.projectPath,
        cwd: source.cwd,
        providerConfig: provider.config,
      },
      source.cwd,
      ctx,
    )
  } catch (err) {
    return { ok: false, error: `Side chat fork failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  const sessionId = randomUUID()
  let session: Session
  try {
    session = mgr.createSession({
      projectPath: source.projectPath,
      cwd: source.cwd,
      providerId: source.providerId,
      id: sessionId,
      ephemeral: true,
      providerSessionId: forkedProviderSessionId,
      firstTurnPreamble: SIDE_CHAT_INSTRUCTIONS,
      gitBranch: source.gitBranch,
      apiProviderId: source.apiProviderId,
      acpAgentId: source.acpAgentId,
      model: source.selectedModel ?? undefined,
      effort: source.selectedEffort as Parameters<SessionManager['createSession']>[0]['effort'],
      permissionMode: source.permissionMode,
      sandboxMode: source.sandboxMode,
    })
  } catch (err) {
    await deleteForkedTranscript(provider.harnessId, forkedProviderSessionId, source.cwd, provider.config)
    return { ok: false, error: `Side chat session failed to start: ${err instanceof Error ? err.message : String(err)}` }
  }
  // Applied after construction rather than through `createSession`, which has no
  // preset option: the preset lives in `providerConfig`, and the setter is the
  // only thing that knows how to fold it in. Safe here because the backend has
  // not started, so the rebuild flag it raises costs nothing.
  if (source.agentPreset) session.setAgentPreset(source.agentPreset)

  log.info(
    '[side-chat] opened %s from %s harness=%s cwd=%s',
    sessionId,
    input.parentSessionId,
    provider.harnessId,
    source.cwd,
  )
  return {
    ok: true,
    sessionId,
    projectPath: source.projectPath,
    cwd: source.cwd,
    harnessId: provider.harnessId,
    providerId: source.providerId,
    apiProviderId: source.apiProviderId,
    acpAgentId: source.acpAgentId,
    selectedModel: session.snapshot.selectedModel,
    selectedEffort: session.snapshot.selectedEffort,
    agentPreset: source.agentPreset,
  }
}

/**
 * Tear down a side chat: stop its runtime, drop it from SessionManager, and make
 * a best effort at removing the provider-side transcript the fork created.
 *
 * The SuperOne database needs no cleanup — an ephemeral session never wrote to it.
 */
export async function closeSideChat(mgr: SessionManager, sessionId: string): Promise<boolean> {
  const session = mgr.getSession(sessionId)
  if (!session) return false
  if (!session.ephemeral) {
    log.warn('[side-chat] refusing to close non-ephemeral session %s', sessionId)
    return false
  }
  const { harnessId, providerId, providerSessionId, cwd } = session.snapshot
  const providerConfig = getSessionProvider(providerId)?.config
  await mgr.disposeSession(sessionId)
  if (providerSessionId) await deleteForkedTranscript(harnessId, providerSessionId, cwd, providerConfig)
  log.info('[side-chat] closed %s', sessionId)
  return true
}

/**
 * Remove the transcript a side-chat fork left behind on the provider.
 *
 * Best effort by design, and deliberately not implemented for every harness.
 * Claude's transcript is a file on a path we can compute, and OpenCode exposes a
 * delete endpoint — for OpenCode this matters more than disk, because an orphan
 * shows up in the user's own OpenCode session history. Codex threads and dsh logs
 * have no cheap removal API, so those forks are left in place: invisible to the
 * user, but not zero-cost on disk.
 */
async function deleteForkedTranscript(
  harnessId: HarnessId,
  providerSessionId: string,
  cwd: string,
  providerConfig?: unknown,
): Promise<void> {
  try {
    if (harnessId === 'claude') {
      const { claudeProjectsDir, claudeProjectSlug } = await import('@superone/claude')
      const { realpathSync, rmSync } = await import('node:fs')
      const { join } = await import('node:path')
      const file = join(claudeProjectsDir(), claudeProjectSlug(realpathSync(cwd)), `${providerSessionId}.jsonl`)
      rmSync(file, { force: true })
      return
    }
    if (harnessId === 'opencode') {
      await deleteOpenCodeForkedSession(providerSessionId, cwd, providerConfig)
      return
    }
    log.debug('[side-chat] no transcript cleanup for harness=%s id=%s', harnessId, providerSessionId)
  } catch (err) {
    log.warn('[side-chat] transcript cleanup failed harness=%s: %s', harnessId, err instanceof Error ? err.message : String(err))
  }
}

/**
 * Delete an OpenCode fork through the same short-lived server the fork was made
 * against.
 *
 * The server is started and closed around the one call rather than reused: a side
 * chat closes long after its fork was created, and holding a server open for the
 * lifetime of a scratch thread costs a process for a request that takes one.
 */
async function deleteOpenCodeForkedSession(
  providerSessionId: string,
  cwd: string,
  providerConfig: unknown,
): Promise<void> {
  const [{ OpenCodeClient, startOpenCodeServer }, { readOpenCodeConfig }] = await Promise.all([
    import('../opencode/opencode-client'),
    import('../opencode/opencode-event-map'),
  ])
  const config = readOpenCodeConfig(providerConfig)
  const server = await startOpenCodeServer({
    binaryPath: config.binaryPath,
    cwd,
    env: config.env,
    serverUrl: config.serverUrl,
    timeoutMs: config.startupTimeoutMs,
  })
  try {
    const client = new OpenCodeClient({
      baseUrl: server.url,
      directory: cwd,
      password: config.serverPassword,
    })
    await client.deleteSession(providerSessionId)
  } finally {
    await server.close()
  }
}
