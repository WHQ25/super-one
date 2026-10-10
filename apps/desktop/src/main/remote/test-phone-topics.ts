import type { AgentEvent } from '@superone/shared/agent-types'
import { createDesktopTopicHub, publishHubEvent } from '../stream/desktop-topics'
import type { Session, SessionManager } from '../session/types'
import { MobileBroadcaster, type MobileTransport } from './mobile-broadcaster'
import { PhoneTopics } from './phone-topics'

/**
 * Test-only: main's phone path (hub event → topic → phones' delivery group)
 * with the given phones online, for tests that drive a session's events.
 */
export function phoneEventPath(
  getSession: (sessionId: string) => Session | null | undefined,
  transport: MobileTransport,
  options: { phones?: string[]; spawnParentOf?: (sessionId: string) => string | null; localEnvironmentId?: string } = {},
) {
  const localEnvironmentId = options.localEnvironmentId ?? 'env-local'
  const topics = createDesktopTopicHub()
  const phones = new PhoneTopics(topics, new MobileBroadcaster({ getSession } as unknown as SessionManager, transport, localEnvironmentId), localEnvironmentId)
  for (const deviceId of options.phones ?? ['phone']) phones.online(deviceId, 'relay')
  return {
    topics,
    phones,
    publish(event: AgentEvent, sessionId = event.sessionId): void {
      publishHubEvent(topics, { event, source: 'session', sessionId }, {
        localEnvironmentId,
        getSession,
        spawnParentOf: options.spawnParentOf ?? (() => null),
      })
    },
  }
}
