import type { HarnessId, HarnessResourcesMap } from '@superone/shared/agent-types'
import type { ChatStore } from '../types'

/**
 * Per-harness connector + resource applicator. Each handler knows how to:
 * - `connect()` to its backend and pull a fresh resource bundle (models,
 *   skills, account, etc).
 * - `apply()` the resource bundle to the chat store, including any
 *   side-effects on per-session state (default model selection, slash
 *   command merge, etc).
 *
 * This is the seam where harness-specific logic lives; the store body
 * (`useChatStore`) only dispatches through `harnessHandlers[harness].xxx`.
 */
export interface HarnessHandler<H extends HarnessId> {
  connect: () => Promise<HarnessResourcesMap[H]>
  apply: (state: ChatStore, resources: HarnessResourcesMap[H]) => Partial<ChatStore>
}

export type HarnessHandlerMap = { [H in HarnessId]: HarnessHandler<H> }
