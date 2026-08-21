import type { AgentErrorInfo, CodexConfigRequirements, CodexMcpResourceReadResult, CodexServerDiagnostics, ImageGenerationItem } from '@superone/shared/agent-types'
import type { CodexAppServerHandle } from './app-server-client'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function readCodexAgentMessageDelivery(value: unknown): 'async' | undefined {
  return value === 'async' ? 'async' : undefined
}

export function readCodexImageGenerationFailure(
  value: unknown,
): ImageGenerationItem['failure'] | undefined {
  const failure = asRecord(value)
  if (!failure || failure.type !== 'usageLimitExceeded') return undefined
  const limitId = readString(failure.limitId)
  if (!limitId) return undefined
  return {
    type: 'usageLimitExceeded',
    limitId,
    resetsAt: readNumber(failure.resetsAt),
  }
}

/** Preserve app-server's typed error category even when its prose is generic. */
export function readCodexErrorOverrides(value: unknown): Omit<Partial<AgentErrorInfo>, 'raw'> {
  const rec = asRecord(value)
  const error = asRecord(rec?.error) ?? rec
  const info = error?.codexErrorInfo ?? error?.codex_error_info
  if (typeof info === 'string') return { code: info }
  const variant = asRecord(info)
  if (!variant) return {}
  const normalizedCode = readString(variant.code)
  if (normalizedCode) {
    const httpStatus = readNumber(variant.httpStatus)
    return { code: normalizedCode, ...(httpStatus === null ? {} : { httpStatus }) }
  }
  const [code, payload] = Object.entries(variant)[0] ?? []
  if (!code) return {}
  const httpStatus = readNumber(asRecord(payload)?.httpStatusCode)
  return { code, ...(httpStatus === null ? {} : { httpStatus }) }
}

export async function readCodexServerDiagnostics(
  client: Pick<CodexAppServerHandle, 'request'>,
): Promise<CodexServerDiagnostics> {
  const result = await client.request('server/diagnostics')
  const process = asRecord(result.process)
  const gauges = Array.isArray(result.gauges) ? result.gauges.flatMap((value) => {
    const gauge = asRecord(value)
    const name = readString(gauge?.name)
    const numeric = readNumber(gauge?.value)
    return name && numeric !== null ? [{ name, value: numeric }] : []
  }) : []
  return {
    process: {
      id: readNumber(process?.id) ?? 0,
      residentMemoryBytes: readNumber(process?.residentMemoryBytes),
      physicalFootprintBytes: readNumber(process?.physicalFootprintBytes),
    },
    gauges,
  }
}

export async function readCodexConfigRequirements(
  client: Pick<CodexAppServerHandle, 'request'>,
): Promise<CodexConfigRequirements | null> {
  const result = await client.request('configRequirements/read', {})
  return asRecord(result.requirements) as CodexConfigRequirements | null
}

export async function readCodexMcpResource(
  client: Pick<CodexAppServerHandle, 'request'>,
  input: { server: string; uri: string; threadId?: string | null; originCallId?: string | null; connectorId?: string | null },
): Promise<CodexMcpResourceReadResult> {
  const result = await client.request('mcpServer/resource/read', {
    server: input.server,
    uri: input.uri,
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.originCallId ? { originCallId: input.originCallId } : {}),
    ...(input.connectorId ? { connectorId: input.connectorId } : {}),
  })
  return {
    server: input.server,
    uri: input.uri,
    contents: Array.isArray(result.contents) ? result.contents : [],
    originCallId: readString(result.originCallId),
  }
}
