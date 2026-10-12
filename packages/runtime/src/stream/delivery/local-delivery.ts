import type { AgentEvent } from '@superone/shared/agent-types'
import { AGENT_EVENT_BATCH_MS } from '@superone/shared/agent-event-batcher'
import { createEventBatcher } from '../event-batcher'

export interface LocalDelivery {
  push(event: AgentEvent): void
  flush(): void
  dispose(): void
}

/** The `local` tier (in-process IPC to the renderer): batch streaming deltas. */
export function createLocalDelivery(
  send: (events: AgentEvent[]) => void,
  batchMs: number = AGENT_EVENT_BATCH_MS,
): LocalDelivery {
  let disposed = false
  const batcher = createEventBatcher(send, { delayMs: batchMs })

  return {
    push(event) {
      if (!disposed) batcher.push(event)
    },
    flush: batcher.flush,
    dispose() {
      if (disposed) return
      batcher.flush()
      disposed = true
    },
  }
}
