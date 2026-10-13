import type { OpenCodeV2Event } from './opencode-v2-types'

/** Native tool IDs are unique within a step, while chat folds steps into a turn. */
export function scopeOpenCodeV2ToolIds(event: OpenCodeV2Event): OpenCodeV2Event {
  const data = event.data as { assistantMessageID?: string; id?: string }
  if (data.assistantMessageID && data.id && event.type.startsWith('session.tool.')) {
    return { ...event, data: { ...event.data, id: `${data.assistantMessageID}:${data.id}` } } as OpenCodeV2Event
  }
  if (event.type === 'permission.asked' && event.data.source?.messageID) {
    const source = event.data.source
    return { ...event, data: { ...event.data, source: { ...source, id: `${source.messageID}:${source.id}` } } }
  }
  return event
}
