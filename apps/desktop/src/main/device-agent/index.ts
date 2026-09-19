import { DEVICE_MEMORY_DISCOVERY_HINT, withMemoryDiscoveryHint } from '@superone/shared/interaction-memory'
import { producerDir } from '../media-output-paths'
import { app } from 'electron'
import type { AgentEvent } from '@superone/shared/agent-types'
import { formatDeviceId, parseDeviceId, type DeviceViewfinderClaim } from '@superone/shared/device'
import { getIosSimulatorManager } from '../ios-simulator'
import { DeviceAgentSession, errorReply, reply, type DeviceToolReply } from './execute'
import { IosSimulatorBackend } from './ios-backend'
import { AndroidBackend } from './android-backend'
import { MirrorBackend } from './mirror-backend'
import { bootDevice } from './boot'
import { requestDeviceControl } from './control'
import { releaseDevice } from './release'
import { listDeviceCatalog } from './device-catalog'
import type { DevicePlatformPort } from '../device/platform-port'
import { devicePlatformPorts, deviceSurfaces } from '../device/registry'
import type { DeviceCapture } from '../device/surface'
import { getAndroidDeviceManager } from '../device/android'
import { getMirrorDeviceManager } from '../device/ios-mirror'
import { DEVICE_GRANTS, type DeviceGrantsPort } from './device-grants'
import { createDeviceRecents, type DeviceRecentsPort } from './device-recents'
import { resolveHeldDevice, type HeldDevice } from './target'
import type { DeviceAgentToolName } from './tools'
import type { TouchDeviceBackend } from './types'
import { recordAction } from './record-action'
import { actionRecordingFromPath, adoptActionRecording } from '../agent/action-recording-store'
import { recordingNote } from '../mcp/show-your-work-notes'
import { executeDeviceRun } from '../jev/device-run-tool'
import { jevSettingError } from '../jev/run-tool-common'
import { DeviceAgentError } from './types'


export {
  DEVICE_AGENT_TOOL_NAMES,
  getDeviceAgentToolDescriptors,
  isDeviceAgentEnabled,
  isDeviceAgentToolName,
  registerDeviceAgentTools,
  type DeviceAgentToolName,
} from './tools'

/**
 * The live snapshot state per DEVICE, tagged with the session that was driving it.
 *
 * Keyed by device because that is what a snapshot is a reading OF: refs and the
 * stateId guarding them describe one screen, and a session holding two devices has
 * two screens that must not share a state store. The session tag is what makes a
 * handover safe — a device that changes hands no longer matches, so the new owner
 * starts from a fresh store rather than inheriting refs into a conversation that
 * never saw them.
 */
const sessions = new Map<string, { session: DeviceAgentSession; sessionId: string }>()

/** Swapped by tests so the tool layer can run without Electron or a device. */
let backendFactory: ((deviceId: string) => TouchDeviceBackend) | null = null

/** The single device an injected backend stands for. No provider, so nothing routes on it. */
const INJECTED_DEVICE_ID = 'injected:device'

export function setDeviceAgentBackendFactory(
  factory: (deviceId: string) => TouchDeviceBackend,
): void {
  backendFactory = factory
  // A different backend invalidates every snapshot taken against the old one.
  sessions.clear()
}

/**
 * Every device this session is driving, without listing the machine.
 *
 * Read straight off each manager's ownership map, which is why it is synchronous and
 * free: `device_act` resolves its target on every call, and a `simctl list devices`
 * there would cost a quarter of a second per tap. Names come from whatever the last
 * listing saw and are only ever used in messages — a device with no cached name still
 * resolves by id.
 */
function heldDevicesFor(sessionId: string): HeldDevice[] {
  // An injected backend stands in for the whole device layer, so there is no
  // ownership map to read and exactly one device to be: its own.
  if (backendFactory) return [{ id: INJECTED_DEVICE_ID }]
  const held: HeldDevice[] = []
  const ios = getIosSimulatorManager(app.getPath('userData'))
  for (const udid of ios.devicesOf(sessionId)) {
    const name = ios.nameOf(udid)
    held.push({ id: formatDeviceId('ios-sim', udid), ...(name ? { name } : {}) })
  }
  const android = getAndroidDeviceManager()
  for (const deviceId of android?.devicesOf(sessionId) ?? []) {
    const name = android?.descriptorFor(deviceId)?.name
    held.push({ id: deviceId, ...(name ? { name } : {}) })
  }
  // One at most, and its name is fixed: macOS mirrors a single phone and does not tell
  // us what its owner called it.
  for (const deviceId of getMirrorDeviceManager()?.devicesOf(sessionId) ?? []) {
    held.push({ id: deviceId, name: 'iPhone' })
  }
  return held
}

/**
 * Which backend speaks to a device, read off the provider in its id.
 *
 * The same pure routing the panel's surfaces use — no state to consult, and nothing
 * that could disagree with which device the user actually approved.
 */
function buildBackend(deviceId: string, sessionId: string): TouchDeviceBackend {
  if (backendFactory) return backendFactory(deviceId)
  const userData = app.getPath('userData')
  const parsed = parseDeviceId(deviceId)
  // Captures land in the driving session's sync zone, so the path the reply
  // names is one a remote agent can read (session-sync-zone.md §6). The
  // simulator resolves its own per-device owner, which is the same session.
  if (parsed?.provider === 'android') {
    const android = getAndroidDeviceManager()
    if (android) return new AndroidBackend(android, deviceId, producerDir(sessionId, 'android'))
  }
  if (parsed?.provider === 'ios-mirror') {
    const mirror = getMirrorDeviceManager()
    if (mirror) return new MirrorBackend(mirror, deviceId, producerDir(sessionId, 'ios-mirror'))
  }
  return new IosSimulatorBackend(getIosSimulatorManager(userData), parsed?.native ?? deviceId)
}

/**
 * Every platform whose devices this session may be offered, in the order the catalog
 * lists them. Swapped by tests alongside the backend.
 */
// Registered only when there is an SDK to talk to. On a machine without one the
// catalog stays single-platform and its output is byte-identical to before Android
// existed — capability detection is the feature flag. Shared with the panel's picker
// via `device/registry`, so the agent and the user are offered the same devices.
let platformPortsFactory: () => DevicePlatformPort[] = () =>
  devicePlatformPorts(app.getPath('userData'))

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

/** Standing control grants, swapped by tests so no settings file is needed. */
let grants: DeviceGrantsPort = DEVICE_GRANTS

export function setDeviceAgentGrants(next: DeviceGrantsPort): void {
  grants = next
}

/**
 * How the control prompt reaches the user.
 *
 * Injected rather than imported: the resolver lives in the MCP layer, which imports
 * this module, and the tool executor must not import it back.
 */
let emitHostEventFor: (sessionId: string) => ((event: AgentEvent) => void) | null = () => null

/** Direct execution-layer signal; unlike chat tool deltas this is harness-independent. */
let viewfinderClaimSink: ((claim: DeviceViewfinderClaim) => void) | null = null

export function setDeviceAgentHostEventResolver(
  resolver: (sessionId: string) => ((event: AgentEvent) => void) | null,
): void {
  emitHostEventFor = resolver
}

export function setDeviceAgentViewfinderClaimSink(
  sink: ((claim: DeviceViewfinderClaim) => void) | null,
): void {
  viewfinderClaimSink = sink
}

function sessionFor(sessionId: string, deviceId: string): DeviceAgentSession {
  const existing = sessions.get(deviceId)
  if (existing && existing.sessionId === sessionId) return existing.session
  const session = new DeviceAgentSession(buildBackend(deviceId, sessionId), sessionId)
  sessions.set(deviceId, { session, sessionId })
  return session
}

function withRecording(
  replyValue: DeviceToolReply,
  recording: ReturnType<typeof actionRecordingFromPath>,
): DeviceToolReply {
  const text = replyValue.content.find((item) => item.type === 'text')?.text
  let result: unknown
  try {
    result = text ? JSON.parse(text) : null
  } catch {
    result = text
  }
  const body = result && typeof result === 'object'
    ? result as Record<string, unknown>
    : { result }
  return {
    ...replyValue,
    content: [
      { type: 'text', text: JSON.stringify({ ...body, recording, recordingNote: recordingNote('recording.savedPath') }) },
      ...replyValue.content.filter((item) => item.type !== 'text'),
    ],
  }
}

/**
 * Snapshots belong to a conversation, so ending one must drop them.
 *
 * Otherwise a new session inherits refs pointing at a screen from the previous
 * conversation — which is exactly the stale-snapshot failure the stateId exists to
 * prevent, arriving through the back door. Every device this session was driving
 * goes, not one: it may have been driving several.
 */
export function disposeDeviceAgentSession(sessionId: string): void {
  for (const [deviceId, entry] of sessions) {
    if (entry.sessionId === sessionId) sessions.delete(deviceId)
  }
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
    if (name === 'device_boot') {
      const { device } = args as { device?: string }
      return reply(await bootDevice({
        ports: platformPortsFactory(),
        request: { device: device ?? '' },
        ...(signal ? { signal } : {}),
      }))
    }
    if (name === 'device_request_control') {
      const { description, device } = args as { description?: string; device?: string }
      return reply(await requestDeviceControl({
        sessionId,
        ports: platformPortsFactory(),
        emitHostEvent: emitHostEventFor(sessionId),
        recents: recentsFactory(sessionId),
        grants,
        request: {
          device: device ?? '',
          ...(description ? { reason: description } : {}),
        },
        ...(signal ? { signal } : {}),
      }))
    }
    if (name === 'device_release') {
      const { device, shutdown } = args as { device?: string; shutdown?: boolean }
      const held = heldDevicesFor(sessionId)
      const result = await releaseDevice({
        ports: platformPortsFactory(),
        held,
        request: { ...(device ? { device } : {}), ...(shutdown ? { shutdown } : {}) },
        ...(signal ? { signal } : {}),
      })
      // The snapshot store described a screen this session can no longer see. Dropped
      // so a later grant of the same device starts from a fresh reading rather than
      // inheriting refs into a device that has since rebooted.
      if (sessions.get(result.device.id)?.sessionId === sessionId) sessions.delete(result.device.id)
      return reply(result)
    }
    if (name === 'device_run') {
      const gate = jevSettingError()
      if (gate) throw new Error(gate)
      return reply(await executeDeviceRun(sessionId, args, (device) => {
        const deviceId = resolveHeldDevice(heldDevicesFor(sessionId), device)
        const session = sessionFor(sessionId, deviceId)
        return { deviceId, session, assertControl: () => {
          resolveHeldDevice(heldDevicesFor(sessionId), deviceId)
          if (sessions.get(deviceId)?.session !== session) {
            throw new DeviceAgentError('STALE_STATE', 'The device session changed while paused. Start a new device_run.')
          }
          viewfinderClaimSink?.({ sessionId, deviceId })
        } }
      }, signal))
    }
    // Every remaining tool drives one device, so which one is settled first — and
    // refused rather than guessed when the session holds more than one.
    const { device } = args as { device?: string }
    const deviceId = resolveHeldDevice(heldDevicesFor(sessionId), device)
    viewfinderClaimSink?.({ sessionId, deviceId })
    const session = sessionFor(sessionId, deviceId)
    switch (name) {
      case 'device_snapshot':
        return withMemoryDiscoveryHint(await session.snapshot(args as { mode?: string; maxNodes?: number }, signal), DEVICE_MEMORY_DISCOVERY_HINT)
      case 'device_query':
        return await session.query(args as { stateId: string; op: string; text?: string; ref?: string })
      case 'device_act':
        if (args.recording !== true) {
          return await session.act(args as Parameters<DeviceAgentSession['act']>[0], signal)
        }
        if (backendFactory) {
          throw new Error('Action recording is unavailable for the injected device backend.')
        }
        {
          const provider = parseDeviceId(deviceId)?.provider
          const surface = deviceSurfaces(app.getPath('userData')).find((candidate) => candidate.provider === provider)
          if (!surface) throw new Error(`Action recording is unavailable for device ${deviceId}.`)
          const startedAt = Date.now()
          const { reply: actReply, capture } = await recordAction<DeviceToolReply, DeviceCapture>({
            start: async () => { await surface.startRecording(deviceId) },
            stop: () => surface.stopRecording(deviceId),
            act: (beforeEffects) => session.act(args as Parameters<DeviceAgentSession['act']>[0], signal, beforeEffects),
            ...(signal ? { signal } : {}),
          })
          if (capture === undefined) return actReply
          if (!capture) {
            throw new Error('The device action ran, but its recording could not be finalized.')
          }
          return withRecording(actReply, adoptActionRecording(sessionId, 'device', capture.path, startedAt))
        }
      case 'device_wait_for':
        return await session.waitFor(args as Parameters<DeviceAgentSession['waitFor']>[0], signal)
    }
  } catch (error) {
    return errorReply(error)
  }
}
