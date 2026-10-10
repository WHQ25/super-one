import type { AgentEvent } from '@superone/shared/agent-types'
import { createDesktopTopicNotices } from '../node-host/desktop-topic-notices'
import { createDesktopTopicHub, publishHubEvent } from '../stream/desktop-topics'
import { LocalTopicRecovery } from '../stream/topic-recovery'
import type { Session } from '../session/types'

export interface TestPhoneWorkspaceSink { onEvents(events: AgentEvent[]): void }

/** Native workspace notices over main's actual topic publishing path, with no transcript subscription. */
export function phoneEventPath(getSession: (sessionId: string) => Session | null | undefined, sink: TestPhoneWorkspaceSink) {
  const localEnvironmentId = 'env-local'
  const topics = createDesktopTopicHub()
  const recovery = new LocalTopicRecovery(localEnvironmentId, () => null)
  const notices = createDesktopTopicNotices(topics, recovery, localEnvironmentId).open({
    topics: [{ kind: 'sessionList', environmentId: localEnvironmentId }], cursors: {},
    snapshot: () => ({}), push: frame => { if (frame.events.length) sink.onEvents(frame.events) },
  })
  return {
    close: () => notices.close(),
    publish(event: AgentEvent, sessionId = event.sessionId): void {
      publishHubEvent(topics, { event, source: 'session', sessionId }, {
        localEnvironmentId, recovery, getSession, spawnParentOf: () => null,
      })
    },
  }
}
