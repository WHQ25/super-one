import type { RelayClient } from './client'
import { EventBuffer } from './buffer'
import { PhoneSessionFeed } from './session-feed'

/** Prepare a second transcript on this channel without changing the visible stream or its buffer. */
export function createSessionView(base: RelayClient) {
  const buffer = new EventBuffer()
  const pending: unknown[][] = []
  let preparing = true
  const feed = new PhoneSessionFeed((input, handlers) => base.subscribeTopics(input, handlers), events => {
    if (!preparing) base.publishSessionEvents(events)
    else if (buffer.isBuffering) buffer.push(events)
    else pending.push(events)
  }, (session, error) => { if (!preparing) base.recoverSession(session, error) }, session => base.retainSession(session))
  const stop = () => feed.stop()
  const client = new Proxy(base, { get(target, property) {
    if (property === 'followSession') return async (input: Parameters<RelayClient['followSession']>[0]) => {
      await feed.follow(input)
      if (!preparing) base.activateSessionView(stop)
    }
    if (property === 'stopSession') return stop
    if (property === 'startBuffering') return () => preparing ? buffer.start() : base.startBuffering()
    if (property === 'releaseBuffer') return () => preparing
      ? { epoch: base.buffer.epoch, batches: buffer.release().batches }
      : base.releaseBuffer()
    const value = Reflect.get(target, property, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  return {
    client,
    // Native stream pushes arrive on this view's own handlers, independent of the source's events.
    ingest() {},
    commit(): unknown[][] {
      if (!preparing) return []
      preparing = false
      base.activateSessionView(stop)
      return pending.splice(0)
    },
  }
}
