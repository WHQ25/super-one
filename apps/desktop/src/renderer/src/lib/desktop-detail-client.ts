import { createDetailClient } from '@superone/chat-core'

/** The window's detail client: rows of remote sessions load their detail through main's environment host. */
export const desktopDetailClient = createDetailClient({
  subscribe: (target, subscriptionId) => window.environment.subscribeDetail(target, subscriptionId),
  unsubscribe: (target, subscriptionId) => { void window.environment.unsubscribeDetail(target, subscriptionId) },
}, { newId: () => crypto.randomUUID() })
