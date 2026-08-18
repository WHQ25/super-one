import { DeepseekRuntime, type ApprovalDecision, type DeepseekApprovalRequest } from '@superone/deepseek'
import { app } from 'electron'
import { join } from 'node:path'
import log from '../logger'
import { getCredentialDecrypted, listCredentials } from '../providers/credential-store'
import { getPlatforms } from '../providers/registry'

/**
 * Credential reference the embedded adapter asks for. It is a *name*, never a
 * value: the credential seam resolves it out of SuperOne's store per request.
 */
export const DEEPSEEK_CREDENTIAL_REF = 'DEEPSEEK_API_KEY'

/** Route defaults shared by the backend and the connect probe. */
export const DEEPSEEK_DEFAULT_PROVIDER = 'deepseek-official'
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-pro'

/** Newest DeepSeek-brand credential in SuperOne's store, decrypted. */
function findDeepseekSecret(): string | undefined {
  const platformIds = new Set(
    getPlatforms().filter((platform) => platform.brand === 'deepseek').map((platform) => platform.id),
  )
  for (const credential of listCredentials()) {
    if (!platformIds.has(credential.platformId)) continue
    const decrypted = getCredentialDecrypted(credential.id)
    if (decrypted?.secret) return decrypted.secret
    // A key stored as an env reference stays in the environment by design.
    if (decrypted?.secretEnv) return process.env[decrypted.secretEnv] || undefined
  }
  return process.env[DEEPSEEK_CREDENTIAL_REF] || undefined
}

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
      // Resolved per request, so re-binding a key in SuperOne settings reaches
      // the next turn without a restart — and no secret enters process.env.
      credentialLookup: (ref) => (ref === DEEPSEEK_CREDENTIAL_REF ? findDeepseekSecret() : undefined),
      deepseekAdapter: {
        apiKeyEnv: DEEPSEEK_CREDENTIAL_REF,
        models: [
          { id: DEEPSEEK_DEFAULT_MODEL, contextWindow: 128_000 },
          { id: 'deepseek-v4-flash', contextWindow: 128_000 },
        ],
      },
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
