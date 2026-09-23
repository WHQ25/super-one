export type CollaborationErrorCode =
  | 'invalid_argument'
  | 'not_found'
  | 'forbidden'
  | 'failed_precondition'

/**
 * Thrown by the shared collaboration core. The node RPC layer maps `code` to its
 * error envelope; desktop surfaces `message` in the MCP tool result.
 */
export class CollaborationError extends Error {
  constructor(message: string, readonly code: CollaborationErrorCode) {
    super(message)
    this.name = 'CollaborationError'
  }
}
