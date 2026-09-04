import type { AgentEvent } from '@superone/shared/agent-types'
import {
  applyEventToSession as applyCoreEventToSession,
  defaultChatCorePorts,
  type ChatCorePorts,
} from '@superone/chat-core'
import type { PerSessionState } from '../types'

export type { ChatCorePorts }
export { defaultChatCorePorts }

const desktopChatCorePorts: ChatCorePorts = {
  ...defaultChatCorePorts,
  trace: (channel, name, payload) => {
    window.app?.trace?.(channel, name, payload)
  },
}

/** Desktop adapter; the reducer implementation is owned by @superone/chat-core. */
export function applyEventToSession(
  session: PerSessionState,
  event: AgentEvent,
  ports: ChatCorePorts = desktopChatCorePorts,
): Partial<PerSessionState> {
  return applyCoreEventToSession(session, event, ports) as Partial<PerSessionState>
}
