/**
 * Cold Grok `x.ai/session/fork`: spawn grok, initialize, fork on disk, close.
 * Does not call session/new — that would mint a junk sibling the child never uses.
 */
import {
  client,
  methods,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk'
import { xaiExtWireMethod } from '../../acp/acp-xai-extensions'
import {
  XAI_SESSION_FORK,
  buildGrokForkParams,
  grokForkTargetPromptIndex,
  parseGrokForkResponse,
} from '../../acp/acp-xai-session-ops'
import { resolveAcpClientVersion } from '../../acp/acp-client-info'
import { GROK_ACP_CLIENT_IDENTIFIER } from '../../acp/acp-permission-preapprove'
import { resolveAcpLaunch } from '../../acp/agent-catalog'
import { spawnAcpProcess } from '../../acp/acp-process'
import log from '../../logger'
import { ensureShellPath } from '../../shell-path'
import type { ForkContext, ForkSource } from '../types'

export interface GrokForkRequest {
  sourceSessionId: string
  sourceCwd: string
  newCwd: string
  targetPromptIndex?: number
  sessionKind?: string
  sourceWorkspaceDir?: string
  agentId?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
}

export type GrokForkConnector = (request: GrokForkRequest) => Promise<string>

/** Same initialize `_meta` as `createAcpRuntime` so fork children park ask/exit. */
export function grokForkInitializeParams(version: string): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    clientInfo: { name: 'superone', version },
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    },
    _meta: {
      askUserQuestion: true,
      exitPlanMode: true,
      clientIdentifier: GROK_ACP_CLIENT_IDENTIFIER,
    },
  }
}

async function spawnGrokFork(request: GrokForkRequest): Promise<string> {
  await ensureShellPath()
  const launch = resolveAcpLaunch({
    agentId: request.agentId,
    command: request.command,
    args: request.args,
    env: request.env,
    cwd: request.sourceCwd,
    defaultCwd: request.sourceCwd,
  })
  const processHandle = spawnAcpProcess(launch)
  try {
    const connection = client({ name: 'superone' }).connect(processHandle.stream)
    await connection.agent.request(
      methods.agent.initialize,
      grokForkInitializeParams(resolveAcpClientVersion()) as never,
    )
    const params = buildGrokForkParams({
      sourceSessionId: request.sourceSessionId,
      sourceCwd: request.sourceCwd,
      newCwd: request.newCwd,
      targetPromptIndex: request.targetPromptIndex,
      sessionKind: request.sessionKind,
      sourceWorkspaceDir: request.sourceWorkspaceDir,
    })
    const raw = await connection.agent.request(xaiExtWireMethod(XAI_SESSION_FORK), params)
    const { newSessionId } = parseGrokForkResponse(raw)
    try { connection.close() } catch { /* ignore */ }
    return newSessionId
  } finally {
    await processHandle.kill().catch(() => undefined)
  }
}

let grokForkConnector: GrokForkConnector = spawnGrokFork

export function setGrokForkConnector(connector: GrokForkConnector | null): void {
  grokForkConnector = connector ?? spawnGrokFork
}

function readAcpConfig(raw: unknown): {
  agentId?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
} {
  if (!raw || typeof raw !== 'object') return {}
  return raw as { agentId?: string; command?: string; args?: string[]; env?: Record<string, string> }
}

export async function forkAcpTranscript(
  source: ForkSource,
  targetCwd: string,
  ctx: ForkContext,
): Promise<string> {
  const config = readAcpConfig(source.providerConfig)
  const sourceCwd = source.cwd?.trim() || source.projectPath
  const targetPromptIndex = ctx.forkFromMessageId
    ? grokForkTargetPromptIndex(ctx.messages, ctx.forkFromMessageId)
    : undefined
  const newSessionId = await grokForkConnector({
    sourceSessionId: source.providerSessionId,
    sourceCwd,
    newCwd: targetCwd,
    ...(targetPromptIndex != null ? { targetPromptIndex } : {}),
    sessionKind: 'fork',
    ...(targetCwd !== sourceCwd ? { sourceWorkspaceDir: sourceCwd } : {}),
    ...config,
  })
  log.info(
    '[acp-fork] x.ai/session/fork src=%s cwd=%s → %s target=%s index=%s',
    source.providerSessionId,
    sourceCwd,
    newSessionId,
    targetCwd,
    targetPromptIndex ?? '(full)',
  )
  return newSessionId
}
