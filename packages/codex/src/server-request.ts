/** Inbound Codex app-server JSON-RPC (server → client). */

export const JSON_RPC_METHOD_NOT_FOUND = -32601

const KNOWN_APPROVAL_METHODS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/requestApproval',
  'mcpServer/elicitation/request',
  'item/tool/requestUserInput',
  'tool/requestUserInput',
])

export function isKnownCodexServerRequest(method: string): boolean {
  return KNOWN_APPROVAL_METHODS.has(method)
}

export function isCodexUserVerificationElicitation(
  params: Record<string, unknown> | undefined,
): boolean {
  return params?.mode === 'openai/userVerification'
}

export function jsonRpcMethodNotFound(id: string | number): {
  jsonrpc: '2.0'
  id: string | number
  error: { code: number; message: string }
} {
  return {
    jsonrpc: '2.0',
    id,
    error: { code: JSON_RPC_METHOD_NOT_FOUND, message: 'Method not found' },
  }
}

export function elicitationCancelResult(): {
  action: 'cancel'
  content: null
  _meta: null
} {
  return { action: 'cancel', content: null, _meta: null }
}

export function approvalDenyResult(): {
  decision: 'deny'
  outcome: { decision: 'deny' }
} {
  return { decision: 'deny', outcome: { decision: 'deny' } }
}
