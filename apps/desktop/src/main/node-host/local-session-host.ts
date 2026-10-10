import type { SessionHostPort } from '@superone/runtime/server'
import { unsupportedMethodError } from '@superone/runtime/server'
import type { DesktopSessionRow } from '../db-remote-controlled-sessions'
import { DesktopSessionReads, type DesktopSessionReadsDeps } from './desktop-session-reads'

/**
 * Methods the local session host refuses until local sessions move onto
 * control leases: until then the desktop's owner model is the only authority
 * for changing them. Listed so a context can leave them out of its methods.
 */
export const LOCAL_SESSION_MUTATIONS: ReadonlySet<string> = new Set([
  'session.create', 'session.setCwd', 'session.patchSettings', 'session.fork', 'session.rename', 'session.setTags',
  'session.setUiFlags', 'session.close', 'session.remove', 'session.send', 'session.interrupt',
  'session.respondPermission', 'session.respondQuestion', 'session.respondPlan', 'session.modUi',
  'session.acquireControl', 'session.renewControl', 'session.releaseControl',
  'session.hostActionsPoll', 'session.claimHostAction', 'session.respondHostAction', 'session.renewHostActionClaim',
  'session.notifyArtifactCompleted',
])

const refuse = (method: string) => () => {
  throw unsupportedMethodError(method)
}

/**
 * `session.*` over every session of this desktop, for the devices that see
 * all of them (its phones). Reads only: records, transcripts and the session
 * events the domain records.
 */
export class LocalSessionHost extends DesktopSessionReads<DesktopSessionRow> implements SessionHostPort {
  constructor(deps: DesktopSessionReadsDeps<DesktopSessionRow>) {
    super(deps)
  }

  /** Every session of this desktop is served; recorded events need no lookup. */
  protected override serves(): boolean {
    return true
  }

  dispose(): void {
    this.disposeReads()
  }

  create = refuse('session.create')
  setCwd = refuse('session.setCwd')
  patchSettings = refuse('session.patchSettings')
  fork = refuse('session.fork')
  rename = refuse('session.rename')
  setTags = refuse('session.setTags')
  setUiFlags = refuse('session.setUiFlags')
  close = refuse('session.close')
  remove = refuse('session.remove')
  send = async () => refuse('session.send')()
  interrupt = refuse('session.interrupt')
  respondPermission = refuse('session.respondPermission')
  respondQuestion = refuse('session.respondQuestion')
  respondPlan = refuse('session.respondPlan')
  modUi = async () => refuse('session.modUi')()
  rebindHostActionController = refuse('session.acquireControl')
  pollHostActions = async () => refuse('session.hostActionsPoll')()
  claimHostAction = refuse('session.claimHostAction')
  renewHostActionClaim = refuse('session.renewHostActionClaim')
  respondHostAction = refuse('session.respondHostAction')
  notifyArtifactsCompleted = async () => refuse('session.notifyArtifactCompleted')()
}
