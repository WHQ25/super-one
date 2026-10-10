import { ConnectionDelivery, deliveryPolicy, type DeliveryPolicy } from '@superone/runtime/stream'
import { trace } from '../agent/event-trace'

/**
 * Each paired phone's delivery state (`ConnectionDelivery`): its summarized
 * sessions, expanded details and profile state. Keyed by device; reset when
 * the phone goes offline.
 */
const deliveries = new Map<string, ConnectionDelivery>()

export function phoneDelivery(deviceId: string): ConnectionDelivery {
  let delivery = deliveries.get(deviceId)
  if (!delivery) deliveries.set(deviceId, delivery = new ConnectionDelivery(deliveryPolicy('relay', 'phone'), { now: () => Date.now(), trace }))
  return delivery
}

/** The phone's link changed; its next deliveries use that tier. */
export function setPhonePolicy(deviceId: string, policy: DeliveryPolicy): void {
  phoneDelivery(deviceId).setPolicy(policy)
}

export function dropPhoneDelivery(deviceId: string): void {
  deliveries.delete(deviceId)
}
