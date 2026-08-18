import type { DeepseekResources } from '@superone/shared/agent-types'
import type { ChatStore } from '../types'

/**
 * DeepSeek Harness resource applicator — P0 minimal bundle.
 * P1 replaces `connect` with a real IPC pull from the embedded dsh tree's
 * `ctx.llm` catalogs (models arrive from `listProviders()`/`listModels()`).
 */
export function applyDeepseekResources(state: ChatStore, resources: DeepseekResources): Partial<ChatStore> {
  return {
    harnessResources: { ...state.harnessResources, dsh: resources },
  }
}
