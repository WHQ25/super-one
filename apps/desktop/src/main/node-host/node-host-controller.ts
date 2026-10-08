import { hostname } from 'node:os'
import { app } from 'electron'
import type { AppSettings, NodeHostPairingToken, NodeHostStatus } from '@superone/shared/agent-types'
import type { HostActionTerminalResult } from '@superone/shared/environment'
import { assertSessionHarnessRuntimeReady } from '@superone/runtime/harness'
import { getMachineInfo } from '@superone/runtime/machine'
import log from '../logger'
import { ensureShellPath } from '../shell-path'
import { readDesktopGuiState } from '../environment/local-node-context'
import { variantId } from '../variant'
import { addRecentFolder, getRecentFolders } from '../recent-folders'
import { createSession as createSessionRow, loadSessionMessagesPaginated, renameSession } from '../db-sessions'
import {
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
import { defaultDesktopNodePort } from './paths'

type NodeHostSettings = Pick<AppSettings, 'remoteNodeAccessEnabled' | 'remoteNodeAccessPort'>

let host: DesktopNodeHost | null = null
let hostPort: number | null = null
let lastError: string | null = null
/** Start/stop run one at a time; a settings change waits for the previous one. */
let transition: Promise<unknown> = Promise.resolve()

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

/**
 * Start, restart or stop the node surface to match the settings. Off by
 * default and running only while the app runs. It listens on every interface
 * so devices on the LAN or a tailnet can reach it; everything beyond `/health`
 * runs inside the pairing-secret encrypted channel.
 */
export function applyNodeHostSettings(settings: NodeHostSettings, sessions: NodeHostSessionManager): Promise<NodeHostStatus> {
  const next = transition.then(async () => {
    const port = settings.remoteNodeAccessPort ?? defaultDesktopNodePort(variantId())
    if (!settings.remoteNodeAccessEnabled) {
      await stopHost()
      lastError = null
      return nodeHostStatus()
    }
    if (host && hostPort === port) return nodeHostStatus()
    await stopHost()
    try {
      // Machine facts in the descriptor probe toolchains on the login-shell PATH.
      await ensureShellPath()
      void getMachineInfo()
      host = await DesktopNodeHost.start(
        {
          userDataDir: app.getPath('userData'),
          appVersion: app.getVersion(),
          sessions,
          store: desktopSessionStore,
          projects: createDesktopProjectsPort({ list: getRecentFolders, add: addRecentFolder }),
          harnesses: getHarnessManager(),
          listAgentProfiles: listSessionAgentProfiles,
          guiState: readDesktopGuiState,
          hooks: {
            probeHarnessReadiness: (_harnesses, id) => probeDesktopHarness(id),
            assertSessionHarnessRuntimeReady: (id, harnesses) =>
              assertSessionHarnessRuntimeReady(id, harnesses, desktopHarnessResolver),
          },
        },
        { bindPort: port, bindHost: '0.0.0.0', advertisedHost: hostname() },
      )
      hostPort = port
      lastError = null
      log.info('[node-host] serving %s', host.url)
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      log.warn('[node-host] start failed: %s', lastError)
    }
    return nodeHostStatus()
  })
  transition = next.catch(() => {})
  return next
}

async function stopHost(): Promise<void> {
  const running = host
  host = null
  hostPort = null
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
  const next = transition.then(stopHost)
  transition = next.catch(() => {})
  return next
}

/** A pairing token for B's settings UI; fails while the surface is off. */
export function mintNodeHostPairingToken(): NodeHostPairingToken {
  if (!host) throw Object.assign(new Error('remote node access is off'), { code: 'failed_precondition' })
  return host.mintPairingToken()
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
