import { describe, expect, it } from 'vitest'
import {
  JSON_RPC_METHOD_NOT_FOUND,
  approvalDenyResult,
  elicitationCancelResult,
  isCodexUserVerificationElicitation,
  isKnownCodexServerRequest,
  jsonRpcMethodNotFound,
} from './server-request'

describe('Codex inbound server-request helpers', () => {
  it('treats approval and elicitation methods as known', () => {
    expect(isKnownCodexServerRequest('mcpServer/elicitation/request')).toBe(true)
    expect(isKnownCodexServerRequest('item/commandExecution/requestApproval')).toBe(true)
    expect(isKnownCodexServerRequest('attestation/generate')).toBe(false)
    expect(isKnownCodexServerRequest('userVerification/status')).toBe(false)
  })

  it('detects openai/userVerification elicitation mode', () => {
    expect(isCodexUserVerificationElicitation({ mode: 'openai/userVerification' })).toBe(true)
    expect(isCodexUserVerificationElicitation({ mode: 'form' })).toBe(false)
  })

  it('builds JSON-RPC method-not-found with the same id', () => {
    expect(jsonRpcMethodNotFound(7)).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: { code: JSON_RPC_METHOD_NOT_FOUND, message: 'Method not found' },
    })
  })

  it('uses elicitation cancel rather than a generic deny envelope', () => {
    expect(elicitationCancelResult().action).toBe('cancel')
    expect(approvalDenyResult().decision).toBe('deny')
  })
})
