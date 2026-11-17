import { useEffect, useMemo, useReducer } from 'react'
import { readableContent } from '@superone/shared/codex-content'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { inlineBodyAddress, withToolBody, type ToolBodyRef } from '@superone/shared/transcript-window/tool-body'
import { remoteToolBodies, windowToolBody } from '@/lib/tool-body-cache'

/** Restore before segmenting or grouping the turn: native galleries consume a widget result at turn level. */
export function useRemoteToolMessages(messages: ChatMessage[], connectionId?: string, sessionId?: string | null) {
  const held = useMemo(() => ({
    mounted: false,
    rows: new WeakMap<ChatMessage, ChatMessage>(),
    observed: new WeakSet<ContentBlock>(),
  }), [connectionId, sessionId])
  const [revision, refresh] = useReducer(n => n + 1, 0)
  useEffect(() => {
    held.mounted = true
    return () => { held.mounted = false }
  }, [held])
  useEffect(() => {
    if (!connectionId || !sessionId) return
    for (const message of messages) {
      if (held.rows.has(message)) continue
      held.rows.set(message, message)
      const content = readableContent(message)
      const missing: Array<{ index: number; ref: ToolBodyRef }> = []
      for (const [index, block] of content.entries()) {
        const ref = windowToolBody(block)
        if (ref) missing.push({ index, ref })
        else if ('toolUseId' in block && !held.observed.has(block)) {
          held.observed.add(block)
          remoteToolBodies.rememberBlock(connectionId, sessionId, message.id, block)
        }
      }
      if (!missing.length) continue
      const restored = [...content]
      void Promise.all(missing.map(async ({ index, ref }) => {
        try {
          const text = await remoteToolBodies.load(connectionId, sessionId, inlineBodyAddress(message.id, ref))
          let block: typeof ref.head = ref.wholeBlock ? JSON.parse(text) : withToolBody(ref.head, text)
          if (block.type === 'tool_result' && block.remoteBody) {
            const { remoteBody, ...head } = block
            const text = await remoteToolBodies.load(connectionId, sessionId, inlineBodyAddress(message.id, { head, ...remoteBody }))
            block = { ...head, summary: text }
          }
          restored[index] = block
        } catch { /* Keep the original omission notice; reopening retries the read. */ }
      })).then(() => {
        held.rows.set(message, { ...message, content: restored })
        if (held.mounted) refresh()
      })
    }
  }, [messages, connectionId, sessionId, held])
  return useMemo(() => connectionId ? messages.map(message => held.rows.get(message) ?? message) : messages,
    [messages, connectionId, held, revision])
}
