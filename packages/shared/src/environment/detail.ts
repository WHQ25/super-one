/**
 * On-demand detail behind a summarized row (`remoteDetail`). A subscribe
 * answers with revision 0; later packets carry the common-prefix `offset` and
 * the new suffix (docs/architecture/mobile-remote-control.md, "Hidden detail").
 */
export interface DetailUpdate {
  subscriptionId: string
  revision: number
  offset: number
  text: string
}

/** One summarized row's detail: its session's environment and session, and the opaque reference. */
export interface DetailTarget {
  environmentId: string
  sessionId: string
  detailRef: string
}
