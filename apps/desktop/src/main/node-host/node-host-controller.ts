import { hostname, networkInterfaces } from 'node:os'
import { app } from 'electron'
import type { AppSettings, NodeHostController, NodeHostStatus } from '@superone/shared/agent-types'
import { encodeNodePairingCode } from '@superone/shared/environment/node-pairing-code'
import type { HostActionTerminalResult } from '@superone/shared/environment'
import { assertSessionHarnessRuntimeReady } from '@superone/runtime/harness'
import { getMachineInfo } from '@superone/runtime/machine'
import { isPrivateNetworkAddress, networkAddressScope } from '@superone/shared/private-network-address'
import log from '../logger'
import { LanAdvertiser } from '../lan-advertiser'
import { NODE_LAN_SERVICE_TYPE } from '../lan-service-type'
import { variantId } from '../variant'
import { addRecentFolder, getRecentFolders } from '../recent-folders'
import { localDraftStore } from '../db-drafts'
import { createSession as createSessionRow, loadSessionMessagesPaginated, renameSession } from '../db-sessions'
import {
  getDesktopSessionRow,
  listDesktopSessionRows,
  getRemoteControlledSession,
  listRemoteControlledSessions,
  setSessionRemoteController,
} from '../db-remote-controlled-sessions'
import { getHarnessManager, probeDesktopHarness } from '../harness/service'
import { desktopHarnessResolver } from '../harness/host'
import { listSessionAgentProfiles } from '../session/agent-profiles'
import { createDesktopProjectsPort } from './desktop-projects-port'
import type { NodeHostSessionManager, NodeHostSessionStore } from './desktop-session-host'
import { DesktopNodeHost } from './node-host-server'
import { DesktopDomain, type DesktopDomainDeps } from './desktop-domain'
import { defaultDesktopNodePort } from './paths'

type NodeHostSettings = Pick<AppSettings, 'remoteNodeAccessEnabled' | 'remoteNodeAccessPort'>
/** What main gives the domain for its phones: its PTYs and its desktop methods. */
type PhonePorts = Pick<DesktopDomainDeps, 'terminals' | 'phoneMethods' | 'projectEdits'>

let host: DesktopNodeHost | null = null
/** This desktop's environment backend, open from the first settings pass until quit. */
let domain: DesktopDomain | null = null
let hostPort: number | null = null
let hostRelayUrl: string | null = null
let advertiser: LanAdvertiser | null = null
let lastError: string | null = null
/** Start/stop run one at a time; a settings change waits for the previous one. */
let transition: Promise<unknown> = Promise.resolve()
/** Persists `remoteNodeAccessEnabled` and applies it; set by main at startup. */
let setHostEnabled: ((enabled: boolean) => Promise<void>) | null = null
/** Whether a controller QR is open here, which keeps the host up. */
let holdOpen: () => boolean = () => false
const changeListeners = new Set<() => void>()
let reconcileTimer: ReturnType<typeof setTimeout> | null = null
/** Allow Control (the phone link's switch) also gates every controller here. */
let accessAllowed = true

const desktopSessionStore: NodeHostSessionStore = {
  createRow: ({ sessionId, projectPath, title, cwd }) => {
    const isWorktree = cwd !== projectPath
    createSessionRow(projectPath, sessionId, title, isWorktree, undefined, isWorktree ? cwd : undefined)
  },
  setController: setSessionRemoteController,
  get: getRemoteControlledSession,
  list: listRemoteControlledSessions,
  rename: renameSession,
  loadMessages: loadSessionMessagesPaginated,
}

export function nodeHostStatus(): NodeHostStatus {
  return {
    running: host !== null,
    url: host?.url ?? null,
    environmentId: host?.identity.environmentId ?? null,
    error: lastError,
  }
}

/** This machine's first Tailscale IPv4 address, if it is on a tailnet. */
function tailscaleAddress(): string | undefined {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && networkAddressScope(entry.address) === 'tailscale') return entry.address
    }
  }
  return undefined
}

/**
 * Start, restart or stop the node surface to match the settings. Off by
 * default and running only while the app runs, like the phone link: it
 * listens on every interface but accepts only private-network peers (LAN,
 * tailnet), advertises itself over mDNS for paired desktops on the same
 * network, and keeps a relay connection for those elsewhere. Everything
 * beyond `/health` runs inside the pairing-secret encrypted channel.
 */
export function applyNodeHostSettings(
  settings: NodeHostSettings,
  sessions: NodeHostSessionManager,
  options: { relayUrl?: string; phonePorts?: PhonePorts } = {},
): Promise<NodeHostStatus> {
  const next = transition.then(async () => {
    // The domain serves this desktop's phones too, so it opens whether or not controllers may connect.
    try {
      openDesktopDomain(sessions, options.phonePorts)
    } catch (err) {
      log.warn('[node-host] domain failed to open: %s', err instanceof Error ? err.message : String(err))
    }
    const port = settings.remoteNodeAccessPort ?? defaultDesktopNodePort(variantId())
    const relayUrl = options.relayUrl || null
    if (!settings.remoteNodeAccessEnabled) {
      await stopHost()
      lastError = null
      return nodeHostStatus()
    }
    if (host && hostPort === port && hostRelayUrl === relayUrl) return nodeHostStatus()
    await stopHost()
    try {
      void getMachineInfo()
      host = await DesktopNodeHost.start(
        openDesktopDomain(sessions, options.phonePorts),
        {
          bindPort: port,
          bindHost: '0.0.0.0',
          advertisedHost: hostname(),
          tailscaleHost: tailscaleAddress(),
          allowRemoteAddress: isPrivateNetworkAddress,
          ...(relayUrl ? { relayUrl } : {}),
          onControllersChanged: notifyChanged,
          log: { info: (m) => log.info(m), warn: (m) => log.warn(m) },
        },
      )
      host.setAccessAllowed(accessAllowed)
      hostPort = port
      hostRelayUrl = relayUrl
      lastError = null
      log.info('[node-host] serving %s', host.url)
      await advertise(host)
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      log.warn('[node-host] start failed: %s', lastError)
    }
    return nodeHostStatus()
  })
  void next.then(notifyChanged)
  transition = next.catch(() => {})
  return next
}

/** This desktop's environment backend, opened once; every connection is served from it. */
export function openDesktopDomain(sessions: NodeHostSessionManager, phonePorts: PhonePorts = {}): DesktopDomain {
  return domain ??= DesktopDomain.open({
    ...phonePorts,
    drafts: localDraftStore(),
    userDataDir: app.getPath('userData'),
    appVersion: app.getVersion(),
    sessions,
    store: desktopSessionStore,
    rows: { get: getDesktopSessionRow, list: listDesktopSessionRows, loadMessages: loadSessionMessagesPaginated },
    projects: createDesktopProjectsPort({ list: getRecentFolders, add: addRecentFolder }),
    harnesses: getHarnessManager(),
    listAgentProfiles: listSessionAgentProfiles,
    hooks: {
      probeHarnessReadiness: (_harnesses, id) => probeDesktopHarness(id),
      assertSessionHarnessRuntimeReady: (id, harnesses) =>
        assertSessionHarnessRuntimeReady(id, harnesses, desktopHarnessResolver),
    },
  })
}

/**
 * Publish the node over mDNS so a paired desktop on this network finds it.
 * TXT `env` is the environment id the pairing recorded; nothing secret.
 */
async function advertise(running: DesktopNodeHost): Promise<void> {
  const next = new LanAdvertiser()
  try {
    await next.publish({
      name: `superone-node-${running.identity.environmentId.replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}`,
      port: running.port,
      serviceType: NODE_LAN_SERVICE_TYPE,
      txt: { env: running.identity.environmentId, variant: variantId() },
    })
    advertiser = next
  } catch (err) {
    log.warn('[node-host] mDNS advertisement failed: %s', err instanceof Error ? err.message : String(err))
  }
}

async function stopHost(): Promise<void> {
  const published = advertiser
  advertiser = null
  await published?.unpublish().catch(() => {})
  const running = host
  host = null
  hostPort = null
  hostRelayUrl = null
  if (!running) return
  try {
    await running.stop()
    log.info('[node-host] stopped')
  } catch (err) {
    log.warn('[node-host] stop failed: %s', err instanceof Error ? err.message : String(err))
  }
}

/** Stop serving (app quit). */
export function stopNodeHost(): Promise<void> {
  const next = transition.then(async () => {
    await stopHost()
    domain?.close()
    domain = null
  })
  transition = next.catch(() => {})
  return next
}

/**
 * The host runs while this computer has a controller, a controller QR is
 * open, or a code it minted can still be redeemed; nobody switches it by hand.
 * Main passes how to persist and apply that (`remoteNodeAccessEnabled`).
 */
export function configureNodeHostLifecycle(opts: {
  setEnabled: (enabled: boolean) => Promise<void>
  pairingOpen: () => boolean
}): void {
  setHostEnabled = opts.setEnabled
  holdOpen = opts.pairingOpen
}

/** Follow Allow Control: off turns every controller away; each keeps its own switch. */
export function setNodeHostAccessAllowed(allowed: boolean): void {
  if (accessAllowed === allowed) return
  accessAllowed = allowed
  host?.setAccessAllowed(allowed)
  notifyChanged()
}

export function onNodeHostChanged(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

function notifyChanged(): void {
  for (const listener of changeListeners) listener()
}

/** Start the host if it is off; fails with the start error. */
export async function ensureNodeHost(): Promise<void> {
  if (!setHostEnabled) throw new Error('node host lifecycle is not configured')
  if (!accessAllowed) throw Object.assign(new Error('Allow Control is off'), { code: 'failed_precondition' })
  await setHostEnabled(true)
  if (!host) {
    throw Object.assign(new Error(lastError ?? 'remote node access could not start'), { code: 'failed_precondition' })
  }
}

/** Stop the host once nothing needs it. */
export async function reconcileNodeHost(): Promise<void> {
  await transition
  if (!host || !setHostEnabled) return
  if (holdOpen() || host.controllers().length > 0 || host.hasLivePairingToken()) return
  log.info('[node-host] no controllers left; stopping')
  await setHostEnabled(false)
}

/**
 * A single-use node pairing code (`superone-node:…`) for one controller. It
 * carries the channel secret, so it goes only to the phone that carries it.
 */
export async function mintNodePairingCode(): Promise<string> {
  await ensureNodeHost()
  const token = host!.mintPairingToken()
  // Check again once the code can no longer be redeemed.
  if (reconcileTimer) clearTimeout(reconcileTimer)
  reconcileTimer = setTimeout(() => {
    reconcileTimer = null
    void reconcileNodeHost()
  }, Math.max(0, token.expiresAt - Date.now()) + 1_000)
  reconcileTimer.unref?.()
  return encodeNodePairingCode(token)
}

export function listNodeHostControllers(): NodeHostController[] {
  return host?.controllers() ?? []
}

export function setNodeHostControllerEnabled(id: string, enabled: boolean): void {
  host?.setControllerEnabled(id, enabled)
}

export async function removeNodeHostController(id: string): Promise<void> {
  host?.removeController(id)
  await reconcileNodeHost()
}

/** This desktop's user takes a session another desktop started here back from it. */
export function releaseNodeHostSession(sessionId: string): void {
  if (!domain) {
    throw Object.assign(new Error('Remote node access is off'), { code: 'failed_precondition' })
  }
  domain.sessions.releaseControl(sessionId)
}

/**
 * Ask the controller of a session served here to run one of its tools (a
 * collaboration child's mailbox tools, whose parent runs on the controller).
 */
export function requestControllerHostAction(
  input: Parameters<DesktopNodeHost['sessions']['requestHostAction']>[0],
): Promise<HostActionTerminalResult> {
  if (!host) {
    return Promise.reject(Object.assign(
      new Error('Remote node access is off, so the machine that launched this session cannot be reached'),
      { code: 'failed_precondition' },
    ))
  }
  return host.sessions.requestHostAction(input)
}
