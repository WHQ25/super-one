import { app } from 'electron'
import type { AgentEvent } from '@superone/shared/agent-types'
import { getIosSimulatorManager } from '../ios-simulator'
import { DeviceAgentSession, errorReply, reply, type DeviceToolReply } from './execute'
import { IosSimulatorBackend } from './ios-backend'
import { requestDeviceControl } from './control'
import { listDeviceCatalog } from './device-catalog'
import type { DevicePlatformPort } from '../device/platform-port'
import { IosSimulatorDevicePort } from '../ios-simulator/device-port'
import { AndroidDevicePort, getAndroidDeviceManager } from '../device/android'
import { createDeviceRecents, type DeviceRecentsPort } from './device-recents'
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

/**
 * Every platform whose devices this session may be offered, in the order the catalog
 * lists them. Swapped by tests alongside the backend.
 */
let platformPortsFactory: () => DevicePlatformPort[] = () => {
  const ports: DevicePlatformPort[] = [
    new IosSimulatorDevicePort(getIosSimulatorManager(app.getPath('userData'))),
  ]
  // Registered only when there is an SDK to talk to. On a machine without one the
  // catalog stays single-platform and its output is byte-identical to before Android
  // existed — capability detection is the feature flag.
  const android = getAndroidDeviceManager()
  if (android) ports.push(new AndroidDevicePort(android))
  return ports
}

export function setDeviceAgentPlatformPortsFactory(
  factory: () => DevicePlatformPort[],
): void {
  platformPortsFactory = factory
}

/** Project-scoped device history, swapped by tests so no database is needed. */
let recentsFactory: (sessionId: string) => DeviceRecentsPort = (sessionId) => createDeviceRecents(sessionId)

export function setDeviceAgentRecentsFactory(factory: (sessionId: string) => DeviceRecentsPort): void {
  recentsFactory = factory
}

/**
 * How the control prompt reaches the user.
 *
 * Injected rather than imported: the resolver lives in the MCP layer, which imports
 * this module, and the tool executor must not import it back.
 */
let emitHostEventFor: (sessionId: string) => ((event: AgentEvent) => void) | null = () => null

export function setDeviceAgentHostEventResolver(
  resolver: (sessionId: string) => ((event: AgentEvent) => void) | null,
): void {
  emitHostEventFor = resolver
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
    if (name === 'device_list') {
      const { kind, model } = args as { kind?: string; model?: string }
      return reply(await listDeviceCatalog({
        sessionId,
        ports: platformPortsFactory(),
        recents: recentsFactory(sessionId),
        request: { ...(kind ? { kind } : {}), ...(model ? { model } : {}) },
      }))
    }
    if (name === 'device_request_control') {
      const { description, device } = args as { description?: string; device?: string }
      return reply(await requestDeviceControl({
        sessionId,
        ports: platformPortsFactory(),
        emitHostEvent: emitHostEventFor(sessionId),
        recents: recentsFactory(sessionId),
        request: {
          device: device ?? '',
          ...(description ? { reason: description } : {}),
        },
        ...(signal ? { signal } : {}),
      }))
    }
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
