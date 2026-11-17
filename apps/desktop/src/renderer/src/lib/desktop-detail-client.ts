import { createDetailClient } from '@superone/chat-core'
import { detailSnapshotBody } from '@superone/shared/transcript-window/tool-body'
import { remoteToolBodies } from './tool-body-cache'

/** The window's detail client: rows of remote sessions load their detail through main's environment host. */
export const desktopDetailClient = createDetailClient({
  subscribe: (target, subscriptionId) => window.environment.subscribeDetail(target, subscriptionId),
  readBody: (target, snapshot) => remoteToolBodies.load(target.environmentId, target.sessionId, snapshot.body, snapshot.subscriptionId),
  rememberBody(target, text) {
    // A live update can be only the first part of a JSON replacement when a row closes.
    try {
      const body = detailSnapshotBody(target.detailRef, text)
      if (body) remoteToolBodies.remember(target.environmentId, { ...body.address, sessionId: target.sessionId }, body.text)
    } catch { /* Only complete tool snapshots can be reused. */ }
  },
  unsubscribe: (target, subscriptionId) => { void window.environment.unsubscribeDetail(target, subscriptionId) },
}, { newId: () => crypto.randomUUID() })
