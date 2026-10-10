import type { DeliveryPolicy, TopicConnection, TopicGroup } from '@superone/runtime/stream'
import { deliveryPolicy } from '@superone/runtime/stream'
import { setPhonePolicy } from './phone-deliveries'
import type { TopicRef } from '@superone/shared/environment/topics'
import type { DesktopTopicHub, DesktopTopicItem } from '../stream/desktop-topics'
import type { Session, SessionLifecycleEvent } from '../session/types'
import type { TerminalOwnership } from '../terminal/terminal-ownership'

/**
 * One topic connection per paired phone, opened while the phone is online.
 * Every phone follows the lists (sessions, projects, drafts, terminals) and
 * environment notices; it follows a session while it subscribes to or holds
 * it, and a terminal while it watches or controls it. Phones share one
 * transport, so their connections deliver through one group.
 */
export class PhoneTopics {
  private readonly connections = new Map<string, TopicConnection<DeliveryPolicy>>()

  constructor(
    private readonly hub: DesktopTopicHub,
    private readonly group: TopicGroup<DesktopTopicItem>,
    private readonly localEnvironmentId: string,
  ) {}

  /** The phone came online, or switched link. */
  online(deviceId: string, transport: 'lan' | 'relay'): void {
    const policy = deliveryPolicy(transport, 'phone')
    setPhonePolicy(deviceId, policy)
    const existing = this.connections.get(deviceId)
    if (existing && !existing.closed) {
      existing.setPolicy(policy)
      return
    }
    this.connectionFor(deviceId, policy)
  }

  offline(deviceId: string): void {
    this.connections.get(deviceId)?.close()
    this.connections.delete(deviceId)
  }

  /** Mirror a session's subscribers and remote owner as phone session topics. */
  watchSession(session: Session): () => void {
    const topic: TopicRef = { kind: 'session', environmentId: this.localEnvironmentId, sessionId: session.id }
    const sync = (deviceId: string) => {
      const interested = session.subscribers.has(deviceId) || (session.owner.kind === 'remote' && session.owner.deviceId === deviceId)
      if (interested) this.connectionFor(deviceId).subscribe(topic)
      else this.connections.get(deviceId)?.unsubscribe(topic)
    }
    return session.onLifecycle((event: SessionLifecycleEvent) => {
      if (event.type === 'subscriber_added' || event.type === 'subscriber_removed') sync(event.deviceId)
      if (event.type === 'owner_changed') {
        if (event.previous.kind === 'remote') sync(event.previous.deviceId)
        if (event.current.kind === 'remote') sync(event.current.deviceId)
      }
    })
  }

  /** Mirror a terminal's watchers and remote writer as phone terminal topics. */
  watchTerminal(terminalId: string, ownership: TerminalOwnership): () => void {
    const topic: TopicRef = { kind: 'terminal', environmentId: this.localEnvironmentId, terminalId }
    return ownership.onInterest((devices) => {
      for (const [deviceId, connection] of this.connections) {
        if (!devices.has(deviceId)) connection.unsubscribe(topic)
      }
      for (const deviceId of devices) this.connectionFor(deviceId).subscribe(topic)
    })
  }

  private connectionFor(deviceId: string, policy = deliveryPolicy('relay', 'phone')): TopicConnection<DeliveryPolicy> {
    const existing = this.connections.get(deviceId)
    if (existing && !existing.closed) return existing
    const connection = this.hub.open({ id: deviceId, policy, sink: { group: this.group } })
    const environmentId = this.localEnvironmentId
    for (const topic of [
      { kind: 'sessionList', environmentId },
      { kind: 'projects', environmentId },
      { kind: 'drafts', environmentId },
      { kind: 'terminalList', environmentId },
      { kind: 'environment', environmentId },
    ] satisfies TopicRef[]) connection.subscribe(topic)
    this.connections.set(deviceId, connection)
    return connection
  }
}
