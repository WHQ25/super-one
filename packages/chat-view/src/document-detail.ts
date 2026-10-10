import { createDetailClient, type DetailUpdate } from '@superone/chat-core'
import { requestNative, requestNativeAsync } from './bridge'

/** The phone document's detail client: RN subscribes for it on the session it shows. */
export const documentDetailClient = createDetailClient({
  subscribe: async (target, subscriptionId) => await requestNativeAsync('subscribeDetail', { detailRef: target.detailRef, subscriptionId }) as DetailUpdate,
  unsubscribe: (_target, subscriptionId) => { requestNative('unsubscribeDetail', { subscriptionId }) },
}, { newId: () => globalThis.crypto?.randomUUID?.() ?? `detail-${Date.now()}-${Math.random().toString(36).slice(2)}` })

export function deliverDetail(update: DetailUpdate): void {
  documentDetailClient.deliver(update)
}
