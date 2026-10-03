import type { PermissionRequest } from '@superone/shared/agent-types'
import { elicitationFormRequest } from '@superone/shared/schema-form'

/** Native form and extended form requests use the same declarative schema. */
export function codexElicitationRequest(
  requestId: string,
  params: Record<string, unknown>,
): PermissionRequest | undefined {
  if (params.mode !== undefined && !['form', 'openaiForm', 'openai/form'].includes(String(params.mode))) return undefined
  const serverName = typeof params.serverName === 'string' ? params.serverName : 'mcp'
  const meta = params._meta && typeof params._meta === 'object' && !Array.isArray(params._meta)
    ? params._meta as Record<string, unknown>
    : {}
  const form = elicitationFormRequest(params.requestedSchema)
  const supportsAlwaysPersist = Array.isArray(meta.persist) && meta.persist.includes('always')
  return {
    requestId,
    toolName: serverName,
    toolUseId: requestId,
    input: {},
    requestKind: 'mcp_elicitation',
    serverName,
    message: typeof params.message === 'string' ? params.message : '',
    ...(typeof meta.subtitle === 'string' ? { subtitle: meta.subtitle } : {}),
    ...(['low', 'medium', 'high'].includes(String(meta.riskLevel)) ? { riskLevel: meta.riskLevel as 'low' | 'medium' | 'high' } : {}),
    supportsAlwaysPersist,
    allowAlwaysAllow: supportsAlwaysPersist && !form.schemaForm,
    ...form,
  }
}
