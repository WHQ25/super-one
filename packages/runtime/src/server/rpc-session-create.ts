import { isAbsolute } from 'node:path'
import { normalizeSessionHarnessId, OPERATION_SCOPES } from '@superone/shared/environment'
import { loadNodeAgentSettings, resolveAgentTurnDefaults } from '../settings/index'
import { settingsFromSessionProviderConfig } from '../session/index'
import type { RpcContext, RpcResult } from './rpc-context'
import { asRecord, mapThrown, requireScopes } from './rpc-helpers'
import { parseSessionSettings } from './session-settings'
import { parseSessionCreateSelections } from './session-create-selections'
import { isAllowedSessionCwd } from './session-cwd'

type CreateRpcContext = RpcContext & Required<Pick<RpcContext, 'sessions' | 'harnesses' | 'projects'>>

export async function handleSessionCreate(payload: unknown, ctx: CreateRpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const rawHarnessId = typeof p.harnessId === 'string' ? p.harnessId : 'claude'
  // Stage 1 wire contract: normalize catalog id acp-grok → session wire acp
  // before persistence so the turn runner never sees an unknown harness id.
  const harnessId = normalizeSessionHarnessId(rawHarnessId)
  if (!harnessId) {
    return {
      error: {
        code: 'invalid_argument',
        message: `unknown harnessId: ${rawHarnessId}`,
      },
    }
  }
  // Catalog ready OR a bundled/binary runtime that can launch without catalog install.
  const catalogReady = ctx.harnesses.isSessionHarnessRunnable(harnessId)
  const codexOverride =
    harnessId === 'codex' && ctx.hooks.isCodexBinaryOverrideRunnable()
  const claudeOverride =
    harnessId === 'claude' && ctx.hooks.isClaudeBinaryOverrideRunnable()
  if (!catalogReady && !codexOverride && !claudeOverride) {
    return {
      error: {
        code: 'failed_precondition',
        message: `harness not ready: ${harnessId}`,
        details: {
          harnessId,
          requestedHarnessId: rawHarnessId,
          readyHarnessIds: ctx.harnesses.readySessionHarnessIds(),
        },
      },
    }
  }
  // Fail-closed: catalog ready must still have a real binary/runtime (no silent sim).
  // Lab overrides (claude SDK / SUPERONE_CODEX_BINARY) satisfy assertSessionHarnessRuntimeReady.
  if (!ctx.simulatedHarness) {
    const runtime = ctx.hooks.assertSessionHarnessRuntimeReady(harnessId, ctx.harnesses)
    if (!runtime.ok) {
      return {
        error: {
          code: 'failed_precondition',
          message: runtime.reason,
          details: {
            harnessId,
            requestedHarnessId: rawHarnessId,
            readyHarnessIds: ctx.harnesses.readySessionHarnessIds(),
          },
        },
      }
    }
  }
  const projectId = String(p.projectId ?? '').trim()
  if (!projectId) {
    return { error: { code: 'invalid_argument', message: 'projectId is required' } }
  }
  if (!ctx.projects.get(projectId)) {
    return { error: { code: 'not_found', message: `unknown projectId: ${projectId}` } }
  }
  // Optional working directory: the project root or one of its worktrees.
  if (p.cwd != null && typeof p.cwd !== 'string') {
    return { error: { code: 'invalid_argument', message: 'cwd must be a string' } }
  }
  const cwd = typeof p.cwd === 'string' && p.cwd.trim() ? p.cwd.trim() : null
  if (cwd !== null && (!isAbsolute(cwd) || !isAllowedSessionCwd(ctx, projectId, cwd))) {
    return { error: { code: 'invalid_argument', message: 'cwd not allowed for this project' } }
  }
  // Optional system-prompt append (e.g. a collaboration prompt for a launched child).
  if (p.systemPromptAppend != null && typeof p.systemPromptAppend !== 'string') {
    return { error: { code: 'invalid_argument', message: 'systemPromptAppend must be a string' } }
  }
  const systemPromptAppend = typeof p.systemPromptAppend === 'string' ? p.systemPromptAppend : null
  // A collaboration child launched by a session on another machine: its mailbox
  // tools go to that machine through Host Actions instead of this node's own.
  const externalParent = asRecord(p.externalParent)
  const externalParentSessionId =
    typeof externalParent.sessionId === 'string' ? externalParent.sessionId.trim() : ''
  if (p.externalParent != null && !externalParentSessionId) {
    return { error: { code: 'invalid_argument', message: 'externalParent.sessionId is required' } }
  }
  try {
    // Resolve agent defaults at create so the client can seed UI without a second round-trip.
    // Precedence: explicit create options → session_providers.config → node agent defaults.
    const agentSettings = loadNodeAgentSettings(ctx.settingsConfigPath)
    const defaults = resolveAgentTurnDefaults(agentSettings, harnessId)
    const options = asRecord(p.options)
    const selectedSettings = parseSessionSettings({ ...p, ...options })
    const selections = parseSessionCreateSelections({ ...p, ...options })
    if (Object.keys(selections).length && !ctx.sessions.createOnHost) throw Object.assign(new Error('This host does not support native creation choices'), { code: 'unsupported' })
    if (selections.gitBranch || selections.worktreeBranch) {
      const denied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
      if (denied) return denied
    }
    const providerId =
      typeof p.providerId === 'string' && p.providerId.trim() ? p.providerId.trim() : undefined
    const profile = providerId ? ctx.sessionProviders?.get(providerId) ?? null : null
    const profileSettings = profile
      ? settingsFromSessionProviderConfig(profile.config)
      : {}
    const pick = (
      fromOptions: unknown,
      fromPayload: unknown,
      fromProfile: string | undefined,
      fromDefaults: string | null | undefined,
    ): string | null => {
      if (typeof fromOptions === 'string' && fromOptions.trim()) return fromOptions.trim()
      if (typeof fromPayload === 'string' && fromPayload.trim()) return fromPayload.trim()
      if (fromProfile) return fromProfile
      return fromDefaults ?? null
    }
    const model = pick(options.model, p.model, profileSettings.model, defaults.model)
    const effort = pick(options.effort, p.effort, profileSettings.effort, defaults.effort)
    const permissionMode = pick(
      options.permissionMode,
      p.permissionMode,
      profileSettings.permissionMode,
      defaults.permissionMode,
    )
    const sandboxMode = pick(
      options.sandboxMode,
      p.sandboxMode,
      profileSettings.sandboxMode,
      defaults.sandboxMode,
    )
    // A credential id on this node; null follows the node's provider binding.
    const apiProviderId = pick(options.apiProviderId, p.apiProviderId, undefined, null)
    const extras = Object.fromEntries(['mode', 'agentPreset', 'additionalDirectories'].filter(key => Object.hasOwn(selectedSettings, key)).map(key => [key, selectedSettings[key as keyof typeof selectedSettings]]))
    if (Object.keys(extras).length) {
      if (!ctx.sessions.validateSettings) throw Object.assign(new Error('This host does not support desktop harness settings'), { code: 'unsupported' })
      ctx.sessions.validateSettings(extras)
    }
    const createInput = {
      projectId,
      harnessId,
      providerId,
      ...(apiProviderId ? { apiProviderId } : {}),
      title: typeof p.title === 'string' ? p.title : undefined,
      cwd,
      systemPromptAppend,
      ...(externalParentSessionId ? { externalParent: { sessionId: externalParentSessionId } } : {}),
      // Initial HA controller = creating client. Token refresh keeps the same
      // clientSessionId; re-pair does not — acquireControl rebinds (see above).
      controllerClientSessionId: ctx.client.clientSessionId,
    }
    const initialSettings = { ...extras, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(permissionMode ? { permissionMode } : {}), ...(sandboxMode ? { sandboxMode } : {}) }
    const assertCreate = () => {
      if (!selections.draftId) return
      if (!ctx.drafts?.assertControl) throw Object.assign(new Error('Draft control is not supported on this host'), { code: 'unsupported' })
      ctx.drafts.assertControl(selections.draftId, ctx.client.clientSessionId, selections.draftLeaseId!)
    }
    assertCreate()
    let session = ctx.sessions.createOnHost
      ? await ctx.sessions.createOnHost({ ...createInput, ...selections }, { settings: initialSettings, assertCreate })
      : ctx.sessions.create(createInput)
    // Seed durable settings from create-time options / profile / agent defaults so later
    // session.send without options reuses the same model/effort/etc.
    if (!ctx.sessions.createOnHost && (model || effort || permissionMode || sandboxMode || Object.keys(extras).length)) {
      session = await ctx.sessions.patchSettings(session.sessionId, {
        ...extras,
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(sandboxMode ? { sandboxMode } : {}),
      })
    }
    return {
      result: {
        ...session,
        defaults: {
          model,
          effort,
          permissionMode,
          sandboxMode,
          permissionPreset: defaults.permissionPreset ?? null,
          disabledSkills: defaults.disabledSkills ?? [],
        },
      },
    }
  } catch (err) {
    return mapThrown(err)
  }
}
