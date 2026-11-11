import {
  methods,
  type ActiveSession,
  type ClientConnection,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
} from '@agentclientprotocol/sdk'
import type { PermissionMode } from '@superone/shared/agent-types'
import { ANTIGRAVITY_AUTH_REQUIRED } from '@superone/shared/antigravity-auth'
import { resolveDesktopAntigravityLaunch } from '../harness/antigravity-launch'
import type { SpawnAcpProcessOptions } from './acp-process'
import type {
  AcpAskUserQuestionGate,
  AcpPermissionGate,
  AcpRuntimeLaunchConfig,
} from './acp-runtime'
import type { ResolvedAcpLaunch } from './agent-catalog'
import {
  extractAntigravityAuthUrlFromStdoutLine,
  extractAntigravityAuthUrlsFromStderrChunk,
  isAntigravityAuthSatisfied,
  prepareAntigravitySpawnContext,
  readAntigravityAuthConfig,
  writeAntigravityAuthConfig,
} from './antigravity-profile'
import {
  ANTIGRAVITY_CLIENT_INFO,
  antigravityPermissionDisposition,
  antigravityPermissionMode,
  antigravitySessionMeta,
  extractAntigravityElicitationQuestion,
  extractAntigravityUserInputQuestion,
  isAntigravityUserInputRequest,
  makeAntigravityElicitationResponse,
  makeAntigravityUserInputResponse,
  selectAntigravityAutoApprovedOptionId,
  type AntigravityElicitationCreateResult,
} from './antigravity-protocol'
import {
  extractAntigravityApiRetryEvent,
  isAntigravityCancelledChunk,
} from '@superone/shared/antigravity-chunks'
import {
  extractAntigravityPromptResponseUsage,
  extractAntigravityWireTurnUsage,
  type AntigravityWireTurnUsage,
} from './antigravity-usage'
import { decideAcpPermission } from './acp-permission-preapprove'
import {
  advanceAntigravityThinkingStepAfterTools,
  closeAntigravityThinkingStep,
  finalizeAntigravityTurnThinking,
  openAntigravityThinkingStep,
  stampAntigravityThoughtDeltas,
  syncAntigravityTurnFromDb,
  type AntigravityTurnThinkingScope,
} from './antigravity-turn-thinking'

export {
  advanceAntigravityThinkingStepAfterTools,
  ANTIGRAVITY_CLIENT_INFO,
  antigravitySessionMeta,
  closeAntigravityThinkingStep,
  extractAntigravityApiRetryEvent,
  extractAntigravityPromptResponseUsage,
  extractAntigravityWireTurnUsage,
  finalizeAntigravityTurnThinking,
  isAntigravityCancelledChunk,
  openAntigravityThinkingStep,
  stampAntigravityThoughtDeltas,
  syncAntigravityTurnFromDb,
  type AntigravityTurnThinkingScope,
  type AntigravityWireTurnUsage,
}

const interactiveAuthPromptListeners = new Set<() => void>()

function notifyInteractiveAuthPrompt(): void {
  for (const listener of [...interactiveAuthPromptListeners]) {
    listener()
  }
}

export async function prepareAntigravityProcessLaunch(
  launch: ResolvedAcpLaunch,
  rawLaunch: AcpRuntimeLaunchConfig,
): Promise<SpawnAcpProcessOptions> {
  const resolved = resolveDesktopAntigravityLaunch(rawLaunch)
  if (!resolved) {
    throw new Error('Antigravity runtime not found. Check Settings → Harnesses → Antigravity.')
  }
  const spawnCtx = prepareAntigravitySpawnContext({
    extraEnv: launch.env,
  })
  launch.command = resolved.command
  launch.args = resolved.args
  launch.env = spawnCtx.extraEnv
  return {
    baseEnv: spawnCtx.baseEnv,
    onStdoutLine: (line) => {
      if (extractAntigravityAuthUrlFromStdoutLine(line)) {
        notifyInteractiveAuthPrompt()
        return true
      }
      return false
    },
    onStderrData: (chunk) => {
      if (extractAntigravityAuthUrlsFromStderrChunk(chunk).length > 0) {
        notifyInteractiveAuthPrompt()
      }
    },
    onExit: spawnCtx.cleanup,
  }
}

export async function handleAntigravityPermissionRequest(
  params: RequestPermissionRequest,
  permissionGate: AcpPermissionGate,
  askUserQuestion?: AcpAskUserQuestionGate,
  permissionMode?: PermissionMode | null,
): Promise<RequestPermissionResponse> {
  if (isAntigravityUserInputRequest(params)) {
    const question = extractAntigravityUserInputQuestion(params)
    if (!question || !askUserQuestion) {
      return { outcome: { outcome: 'cancelled' } }
    }
    const answer = await askUserQuestion.request(question)
    return makeAntigravityUserInputResponse(params, answer)
  }
  const hostDecision = decideAcpPermission(params)
  if (hostDecision.kind !== 'prompt') {
    return permissionGate.request(params)
  }
  if (antigravityPermissionDisposition(permissionMode, params) === 'allow') {
    const optionId = selectAntigravityAutoApprovedOptionId(params)
    if (optionId) {
      return { outcome: { outcome: 'selected', optionId } }
    }
  }
  return permissionGate.request(params)
}

export async function handleAntigravityElicitationCreate(
  rawParams: unknown,
  askUserQuestion?: AcpAskUserQuestionGate,
): Promise<AntigravityElicitationCreateResult> {
  const question = extractAntigravityElicitationQuestion(rawParams)
  if (!question || !askUserQuestion) {
    return makeAntigravityElicitationResponse(rawParams, { outcome: 'cancelled' })
  }
  const answer = await askUserQuestion.request(question)
  return makeAntigravityElicitationResponse(rawParams, answer)
}

export async function authenticateAntigravityRuntime(
  connection: ClientConnection,
  customHome?: string,
): Promise<void> {
  const cfg = readAntigravityAuthConfig(customHome)
  if (
    (cfg.authMethod === 'gemini-api-key' || cfg.authMethod === 'agent-platform') &&
    !isAntigravityAuthSatisfied(customHome)
  ) {
    throw new Error(ANTIGRAVITY_AUTH_REQUIRED)
  }
  if (cfg.authMethod === 'oauth-business' && (!cfg.gcpProject || !cfg.gcpLocation)) {
    throw new Error(ANTIGRAVITY_AUTH_REQUIRED)
  }

  let abortPrompt: (() => void) | null = null
  const promptAbort = new Promise<never>((_, reject) => {
    abortPrompt = () => reject(new Error(ANTIGRAVITY_AUTH_REQUIRED))
    interactiveAuthPromptListeners.add(abortPrompt)
  })

  try {
    await Promise.race([
      connection.agent.request(methods.agent.authenticate, {
        methodId: cfg.authMethod,
      }),
      promptAbort,
    ])
    if (
      (cfg.authMethod === 'oauth-personal' || cfg.authMethod === 'oauth-business') &&
      !cfg.oauthSignedIn
    ) {
      try {
        writeAntigravityAuthConfig({ authMethod: cfg.authMethod, oauthSignedIn: true }, customHome)
      } catch {
        void 0
      }
    }
  } catch (err) {
    if (
      (cfg.authMethod === 'oauth-personal' || cfg.authMethod === 'oauth-business') &&
      cfg.oauthSignedIn
    ) {
      try {
        writeAntigravityAuthConfig({ authMethod: cfg.authMethod, oauthSignedIn: false }, customHome)
      } catch {
        void 0
      }
    }
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(msg.startsWith(ANTIGRAVITY_AUTH_REQUIRED) ? msg : `${ANTIGRAVITY_AUTH_REQUIRED}: ${msg}`)
  } finally {
    if (abortPrompt) interactiveAuthPromptListeners.delete(abortPrompt)
  }
}

type AcpAgentWithAttach = {
  attachSession(response: {
    sessionId: string
    configOptions?: SessionConfigOption[] | null
    modes?: unknown
    _meta?: Record<string, unknown> | null
    [key: string]: unknown
  }): ActiveSession
}

export async function resumeAntigravitySession(
  connection: ClientConnection,
  resumeId: string,
  cwd: string,
  mcpServers: unknown[],
  permissionMode?: PermissionMode | null,
  systemPromptAppend?: string | null,
): Promise<ActiveSession> {
  const sessionResponse: {
    sessionId: string
    configOptions?: SessionConfigOption[] | null
    modes?: unknown
    _meta?: Record<string, unknown> | null
    [key: string]: unknown
  } = { sessionId: resumeId }
  const agentWithAttach = connection.agent as unknown as AcpAgentWithAttach
  const attached = agentWithAttach.attachSession(sessionResponse)
  try {
    const resumeMethod =
      (methods.agent.session as Record<string, unknown>).resume ?? 'session/resume'
    const result = (await connection.agent.request(resumeMethod as never, {
      sessionId: resumeId,
      cwd,
      mcpServers,
      _meta: antigravitySessionMeta(permissionMode, systemPromptAppend),
    } as never)) as {
      configOptions?: SessionConfigOption[] | null
      modes?: unknown
      _meta?: Record<string, unknown> | null
    } | null | undefined
    if (result && typeof result === 'object') {
      if (result.configOptions !== undefined) sessionResponse.configOptions = result.configOptions
      if (result.modes !== undefined) sessionResponse.modes = result.modes
      if (result._meta !== undefined) sessionResponse._meta = result._meta
    }
    return attached
  } catch (err) {
    try {
      attached.dispose()
    } catch {
      void 0
    }
    throw err
  }
}

export async function applyAntigravityPermissionMode(
  connection: ClientConnection,
  sessionId: string,
  mode: PermissionMode | undefined | null,
): Promise<void> {
  const modeId = antigravityPermissionMode(mode)
  try {
    await connection.agent.request(methods.agent.session.setMode, {
      sessionId,
      modeId,
    })
  } catch (err) {
    if (modeId === 'default') throw err
    await connection.agent.request(methods.agent.session.setMode, {
      sessionId,
      modeId: 'default',
    })
  }
}
