/**
 * Authenticated RPC command envelopes and receipts.
 * Mutating operations carry a client-generated idempotency key.
 */

export interface RpcCommandEnvelope<T = unknown> {
  protocolVersion: number
  requestId: string
  /** Required for mutating operations; omitted for pure reads. */
  idempotencyKey?: string
  environmentId: string
  method: string
  payload: T
}

export interface RpcCommandReceipt<T = unknown> {
  requestId: string
  /** Echo of the idempotency key when present. */
  idempotencyKey?: string
  environmentId: string
  /** Wall-clock ms when the node committed the result. */
  committedAt: number
  /** Highest event sequence allocated by this command (decimal string), if any. */
  maxSequence?: string
  result: T
}

export type RpcErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'idempotency_conflict'
  | 'invalid_argument'
  | 'failed_precondition'
  | 'unavailable'
  | 'internal'
  | 'protocol_incompatible'
  | 'environment_mismatch'
  | 'lease_required'
  | 'lease_stale'
  | 'cursor_too_old'
  | 'identity_conflict'

export interface RpcError {
  code: RpcErrorCode
  message: string
  /** Machine-readable details; never secrets or file contents. */
  details?: Record<string, unknown>
}

export interface RpcErrorResponse {
  requestId: string
  error: RpcError
}

/** Idempotency receipt key: (clientIdentity, operation, idempotencyKey). */
export interface IdempotencyReceiptKey {
  clientIdentity: string
  operation: string
  idempotencyKey: string
}

export interface IdempotencyReceiptRecord {
  key: IdempotencyReceiptKey
  /** Canonical hash of the request payload; same key + different hash → conflict. */
  requestPayloadHash: string
  receipt: RpcCommandReceipt
  createdAt: number
}

export function isRpcErrorResponse(value: unknown): value is RpcErrorResponse {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v.requestId !== 'string') return false
  if (!v.error || typeof v.error !== 'object') return false
  const err = v.error as Record<string, unknown>
  return typeof err.code === 'string' && typeof err.message === 'string'
}
