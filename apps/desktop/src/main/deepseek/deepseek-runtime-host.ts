import { DeepseekRuntime, type ApprovalDecision, type DeepseekApprovalRequest } from '@superone/deepseek'
import { app } from 'electron'
import { join } from 'node:path'
import log from '../logger'

/**
 * One embedded dsh Cordis tree per app lifetime, shared by every DeepSeek
 * session (design D2). Approval questions are routed to whichever backend owns
 * the asking agent; the runtime itself stays UI-agnostic.
 */

export type ApprovalRouter = (request: DeepseekApprovalRequest) => Promise<ApprovalDecision> | null

const approvalRouters = new Map<string, ApprovalRouter>()
let runtimePromise: Promise<DeepseekRuntime> | null = null

/** Register the answerer for one session's approval questions. */
export function registerApprovalRouter(sessionId: string, router: ApprovalRouter): () => void {
  approvalRouters.set(sessionId, router)
  return () => approvalRouters.delete(sessionId)
}

export function getDeepseekRuntime(): Promise<DeepseekRuntime> {
  if (!runtimePromise) {
    runtimePromise = DeepseekRuntime.create({
      // Harness identity stays on; SuperOne additions ride the persona field
      // (docs/draft/deepseek-harness-integration.md §12.1).
      persona: '',
      persistenceRoot: join(app.getPath('userData'), 'deepseek-sessions'),
      onApproval: async (request) => {
        const decision = approvalRouters.get(request.sessionId)?.(request)
        // No owner (session closed mid-question) fails closed.
        return decision ? await decision : 'rejected'
      },
    }).catch((error: unknown) => {
      runtimePromise = null
      log.error('[deepseek] runtime boot failed', error)
      throw error
    })
  }
  return runtimePromise
}

export async function disposeDeepseekRuntime(): Promise<void> {
  const pending = runtimePromise
  if (!pending) return
  runtimePromise = null
  approvalRouters.clear()
  const runtime = await pending.catch(() => null)
  await runtime?.dispose()
}
