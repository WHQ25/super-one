import { app } from 'electron'
import { getIosSimulatorManager } from '../ios-simulator'
import { DeviceAgentSession, errorReply, type DeviceToolReply } from './execute'
import { IosSimulatorBackend } from './ios-backend'
import type { DeviceAgentToolName } from './tools'
import type { TouchDeviceBackend } from './types'

export {
  DEVICE_AGENT_TOOL_NAMES,
  getDeviceAgentToolDescriptors,
  isDeviceAgentEnabled,
  isDeviceAgentToolName,
  registerDeviceAgentTools,
  type DeviceAgentToolName,
} from './tools'

const sessions = new Map<string, DeviceAgentSession>()

/** Swapped by tests so the tool layer can run without Electron or a simulator. */
let backendFactory: (sessionId: string) => TouchDeviceBackend = (sessionId) =>
  new IosSimulatorBackend(getIosSimulatorManager(app.getPath('userData')), sessionId)

export function setDeviceAgentBackendFactory(
  factory: (sessionId: string) => TouchDeviceBackend,
): void {
  backendFactory = factory
}

function sessionFor(sessionId: string): DeviceAgentSession {
  let session = sessions.get(sessionId)
  if (!session) {
    session = new DeviceAgentSession(backendFactory(sessionId))
    sessions.set(sessionId, session)
  }
  return session
}

/**
 * Snapshots are per chat session, so ending one must drop them.
 *
 * Otherwise a new session inherits refs pointing at a screen from the previous
 * conversation — which is exactly the stale-snapshot failure the stateId exists to
 * prevent, arriving through the back door.
 */
export function disposeDeviceAgentSession(sessionId: string): void {
  sessions.delete(sessionId)
}

export async function executeDeviceAgentTool(
  sessionId: string,
  name: DeviceAgentToolName,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<DeviceToolReply> {
  try {
    const session = sessionFor(sessionId)
    switch (name) {
      case 'device_snapshot':
        return await session.snapshot(args as { mode?: string; maxNodes?: number }, signal)
      case 'device_query':
        return await session.query(args as { stateId: string; op: string; text?: string; ref?: string })
      case 'device_act':
        return await session.act(args as Parameters<DeviceAgentSession['act']>[0], signal)
      case 'device_wait_for':
        return await session.waitFor(args as Parameters<DeviceAgentSession['waitFor']>[0], signal)
    }
  } catch (error) {
    return errorReply(error)
  }
}
