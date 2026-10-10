import { randomUUID } from 'node:crypto'
import type { AgentEvent } from '@superone/shared/agent-types'
import { withoutDraftAttachmentBytes } from '@superone/shared/environment/draft-content'
import { topicKey, type TopicRef, type TopicVersionCursor } from '@superone/shared/environment/topics'
import { deliveryPolicy, DRAFT_SAVE_INTERVAL_MS } from '@superone/runtime/stream'
import type { RpcContext } from '@superone/runtime/server'
import type { DesktopTopicHub } from '../stream/desktop-topics'
import type { LocalTopicRecovery } from '../stream/topic-recovery'
import log from '../logger'

const KINDS = new Set(['sessionList', 'projects', 'drafts', 'environment'])
const withoutBytes = (event: AgentEvent): AgentEvent => event.type === 'draft_changed' && event.draft
  ? { ...event, draft: withoutDraftAttachmentBytes(event.draft) } : event

/** Native readers use the same published topics and change logs as the desktop's other frontends. */
export function createDesktopTopicNotices(
  hub: DesktopTopicHub,
  recovery: LocalTopicRecovery,
  environmentId: string,
  enrich: (topic: TopicRef, snapshot: unknown) => unknown = (_topic, snapshot) => snapshot,
): NonNullable<RpcContext['topicNotices']> {
  return {
    open(input) {
      const policy = input.policy ?? deliveryPolicy('ipc', 'desktop')
      let pending: { topic: TopicRef; afterVersion: number; cursor: TopicVersionCursor; events: Map<string, AgentEvent> } | null = null
      let timer: ReturnType<typeof setTimeout> | undefined
      const cancel = () => { clearTimeout(timer); timer = undefined; pending = null }
      const flush = () => {
        const saved = pending
        cancel()
        if (saved) input.push({ topic: saved.topic, afterVersion: saved.afterVersion, cursor: saved.cursor, events: [...saved.events.values()] })
      }
      const connection = hub.open({
        id: `rpc-workspace:${randomUUID()}`, policy,
        sink: { deliver(topic, item) {
          if (item.kind !== 'agent' || item.replay) return
          const cursor = recovery.cursor(topic)
          if (topic.kind === 'drafts' && cursor && policy.tier === 'relay') {
            const event = withoutBytes(item.event)
            if (event.type === 'draft_changed' && event.reason === 'saved') {
              if (!pending) {
                pending = { topic, afterVersion: cursor.version - 1, cursor, events: new Map() }
                timer = setTimeout(() => {
                  try { flush() } catch (error) { log.warn('[topics] draft save delivery failed: %s', error) }
                }, DRAFT_SAVE_INTERVAL_MS)
                timer.unref?.()
              }
              pending.cursor = cursor
              pending.events.set(event.draftId, event)
              return
            }
            // Preserve cursor order before an immediate lease or delete notice.
            if (event.type === 'draft_changed') pending?.events.delete(event.draftId)
            flush()
          }
          input.push({ topic, ...(cursor ? { cursor } : {}), events: [withoutBytes(item.event)] })
        } },
      })
      const setTopics = (topics: readonly TopicRef[]) => {
        const wanted = topics.filter(topic => topic.environmentId === environmentId && KINDS.has(topic.kind))
        const keys = new Set(wanted.map(topicKey))
        if (pending && !keys.has(topicKey(pending.topic))) cancel()
        for (const topic of connection.topics()) if (!keys.has(topicKey(topic))) connection.unsubscribe(topic)
        for (const topic of wanted) {
          if (connection.has(topic)) continue
          connection.subscribe(topic)
          const resumed = recovery.recover(topic, input.cursors[topicKey(topic)])
          if (resumed?.kind === 'replay') {
            input.push({ topic, cursor: resumed.cursor, events: resumed.items.map(withoutBytes) })
          } else {
            const snapshot = enrich(topic, input.snapshot(topic))
            const cursor = recovery.cursor(topic)
            input.push({ topic, ...(cursor ? { cursor } : {}), events: [], snapshot })
          }
        }
      }
      try { setTopics(input.topics) } catch (error) { cancel(); connection.close(); throw error }
      return { setTopics, close: () => { cancel(); connection.close() } }
    },
  }
}
