/**
 * `composer.open` for a mini-app, from its MiniApp Host or its WebView: an input
 * request in one local session that authorizes the app. `caller` output returns
 * the answer only to the app; `agent` output sends it as a user message. Remote
 * sessions are not supported yet.
 */
import { admitInputRequestSpec, inputRequestMeta, type InputRequestOutput } from '@superone/shared/input-request'
import { InputRequestOpenError, liveInputRequestCount, openInputRequest, type InputRequestSession, type OpenedInputRequest } from '../session/input-requests'

/** Live forms one app may hold per session; more are refused without touching the slot. */
const MAX_LIVE_PER_SESSION = 4

export interface MiniAppInputRequestDeps {
  /** A live local desktop session; node sessions are never found here. */
  getSession(sessionId: string): (InputRequestSession & { readonly projectPath: string }) | null
  sessionsAuthorizingApp(projectDir: string, appId: string): string[]
}

export interface MiniAppInputRequest {
  appId: string
  appName?: string
  projectDir: string
  /** From the trusted tool-call context or the app's own choice; omitted → the app's only session. */
  sessionId?: string
  spec: unknown
  output: InputRequestOutput
}

export function miniAppInputOwner(projectDir: string, appId: string): string {
  return `miniapp:${projectDir}:${appId}`
}

/** Throws an author-facing `InputRequestOpenError` when the form cannot be shown; otherwise shows it. */
export function openMiniAppInputRequest(deps: MiniAppInputRequestDeps, request: MiniAppInputRequest): OpenedInputRequest {
  const authorized = deps.sessionsAuthorizingApp(request.projectDir, request.appId)
  let sessionId = request.sessionId
  if (!sessionId) {
    if (authorized.length !== 1) {
      throw authorized.length === 0
        ? new InputRequestOpenError('not_found', 'composer.open: no session has this app open')
        : new InputRequestOpenError('invalid', 'composer.open: the app is open in several sessions; pass { session } from the tool call context')
    }
    sessionId = authorized[0]!
  }
  const session = deps.getSession(sessionId)
  if (!session) throw new InputRequestOpenError('unsupported', 'composer.open: forms are only available in local desktop sessions for now')
  if (session.projectPath !== request.projectDir || !authorized.includes(sessionId)) {
    throw new InputRequestOpenError('denied', 'composer.open: the app is not authorized in that session')
  }
  // One quota for the app's Host and WebViews together.
  const owner = miniAppInputOwner(request.projectDir, request.appId)
  if (liveInputRequestCount({ sessionId, owner }) >= MAX_LIVE_PER_SESSION) {
    throw new InputRequestOpenError('busy', `composer.open: at most ${MAX_LIVE_PER_SESSION} forms may be open per session`)
  }
  const admitted = admitInputRequestSpec(request.spec, { userResources: true })
  if (!admitted.ok) throw new InputRequestOpenError('invalid', `composer.open: ${admitted.error}`)
  const { requestId, outcome } = openInputRequest(session, {
    meta: inputRequestMeta(admitted.spec, { kind: 'miniapp', appId: request.appId, ...(request.appName ? { appName: request.appName } : {}) }, request.output),
    form: admitted.form,
    owner,
  })
  return { requestId, sessionId, output: request.output, outcome }
}
