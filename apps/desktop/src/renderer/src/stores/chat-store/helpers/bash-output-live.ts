/**
 * Live bash / tool-output tail for chat UI.
 *
 * Local projects use desktop `watchBashOutput` (fs.watch on absolute paths).
 * Remote projects must never touch local fs.watch — they go through
 * EnvironmentHost → node `workspace.tailWatch*` RPC (or a readFile-offset
 * composition adapter when the dedicated IPC is not yet exposed).
 */
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { useAppStore } from '../../app'
import { useChatStore } from '../index'

export type BashTailWatchStartResult = {
  watchId: string
  offset: number
  relativePath: string
}

export type BashTailWatchPollResult = {
  content: string
  encoding: 'base64'
  offset: number
  size: number
  missing?: boolean
}

/** Node / EnvironmentHost port used by the remote live-tail path. */
export interface BashTailWatchPort {
  start(input: {
    project: { environmentId: string; projectId: string }
    relativePath: string
    offset?: number
  }): Promise<BashTailWatchStartResult>
  poll(input: { watchId: string }): Promise<BashTailWatchPollResult>
  stop(input: { watchId: string }): Promise<{ ok: boolean }>
}

const DEFAULT_POLL_MS = 400
const STABLE_TIMEOUT_MS = 5000
const activeRemote = new Map<
  string,
  { stop: () => void; watchId: string; port: BashTailWatchPort }
>()

/** Project-relative form of a tool output path under projectRoot; null if outside. */
export function toToolOutputRelativePath(
  projectRoot: string,
  absoluteOrRelative: string,
): string | null {
  if (!absoluteOrRelative || absoluteOrRelative.includes('\0')) return null
  const root = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  const path = absoluteOrRelative.replace(/\\/g, '/')
  let rel: string
  if (path === root) return null
  if (path.startsWith(root + '/')) {
    rel = path.slice(root.length + 1)
  } else if (!path.startsWith('/') && !/^[A-Za-z]:\//.test(path)) {
    rel = path.replace(/^\.\//, '')
  } else {
    return null
  }
  rel = rel.replace(/^\/+/, '')
  if (!(rel === 'temp' || rel.startsWith('temp/'))) return null
  return rel
}

function decodeTailContent(content: string, encoding: 'base64' | string | undefined): string {
  if (!content) return ''
  if (encoding === 'base64') {
    try {
      // Browser / jsdom
      if (typeof atob === 'function') {
        const bin = atob(content)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      }
    } catch {
      /* fall through */
    }
    return content
  }
  return content
}

function pushBashOutput(toolUseId: string, content: string, finished: boolean, outputPath: string): void {
  useChatStore.setState((s) => ({
    _bashOutputs: {
      ...s._bashOutputs,
      [toolUseId]: { content, finished, outputPath },
    },
  }))
}

/**
 * Build a tail-watch port that calls node RPC via EnvironmentHost gateway methods
 * when exposed on `window.environment`, otherwise composes full-file reads through
 * `workspaceReadFile` (same content as offset poll for small tool outputs).
 */
export function createEnvironmentBashTailPort(): BashTailWatchPort | null {
  const env = (
    typeof window !== 'undefined'
      ? (window as unknown as {
          environment?: {
            workspaceTailWatchStart?: (
              project: { environmentId: string; projectId: string },
              relativePath: string,
              offset?: number,
            ) => Promise<BashTailWatchStartResult>
            workspaceTailWatchPoll?: (watchId: string) => Promise<BashTailWatchPollResult>
            workspaceTailWatchStop?: (watchId: string) => Promise<{ ok: boolean }>
            workspaceReadFile?: (
              project: { environmentId: string; projectId: string },
              relativePath: string,
            ) => Promise<{ content: string | Uint8Array; hash?: string }>
            getLocalId?: () => Promise<string>
          }
        }).environment
      : undefined
  )
  if (!env) return null

  if (
    typeof env.workspaceTailWatchStart === 'function' &&
    typeof env.workspaceTailWatchPoll === 'function' &&
    typeof env.workspaceTailWatchStop === 'function'
  ) {
    return {
      start: (input) =>
        env.workspaceTailWatchStart!(input.project, input.relativePath, input.offset),
      poll: (input) => env.workspaceTailWatchPoll!(input.watchId),
      stop: (input) => env.workspaceTailWatchStop!(input.watchId),
    }
  }

  if (typeof env.workspaceReadFile !== 'function') return null

  // Composition: re-read full file via workspace.readFile (node RPC) and emit as
  // cumulative content. Offset tracking is client-side string length of utf8.
  const sessions = new Map<
    string,
    { project: { environmentId: string; projectId: string }; relativePath: string; text: string }
  >()

  return {
    async start(input) {
      const watchId = `compose-${crypto.randomUUID()}`
      sessions.set(watchId, {
        project: input.project,
        relativePath: input.relativePath,
        text: '',
      })
      return { watchId, offset: 0, relativePath: input.relativePath }
    },
    async poll(input) {
      const s = sessions.get(input.watchId)
      if (!s) {
        throw Object.assign(new Error('tail watch not found'), { code: 'not_found' })
      }
      const raw = await env.workspaceReadFile!(s.project, s.relativePath)
      let text = ''
      if (typeof raw.content === 'string') {
        text = raw.content
      } else if (raw.content instanceof Uint8Array) {
        text = new TextDecoder('utf-8', { fatal: false }).decode(raw.content)
      }
      // Emit full content as "appended from 0" so UI matches local watcher (tail of full file).
      const prev = s.text
      s.text = text
      const delta = text.startsWith(prev) ? text.slice(prev.length) : text
      const encoded =
        typeof btoa === 'function'
          ? btoa(unescape(encodeURIComponent(delta)))
          : Buffer.from(delta, 'utf8').toString('base64')
      return {
        content: encoded,
        encoding: 'base64',
        offset: text.length,
        size: text.length,
      }
    },
    async stop(input) {
      sessions.delete(input.watchId)
      return { ok: true }
    },
  }
}

export type StartBashOutputLiveOptions = {
  toolUseId: string
  outputPath: string
  /** Chat project key (`remote:conn:path` or local absolute path). */
  projectKey: string | null | undefined
  projectId?: string | null
  /** Node environment id when known; otherwise resolved from environment.listItems. */
  environmentId?: string | null
  /** Injectable for tests; production uses createEnvironmentBashTailPort(). */
  port?: BashTailWatchPort | null
  pollIntervalMs?: number
}

async function resolveRemoteEnvironmentId(connectionId: string): Promise<string> {
  const env = (
    typeof window !== 'undefined'
      ? (window as unknown as {
          environment?: {
            listItems?: () => Promise<Array<{ connectionId: string; environmentId: string }>>
          }
        }).environment
      : undefined
  )
  if (!env?.listItems) return connectionId
  try {
    const items = await env.listItems()
    const hit = items.find((i) => i.connectionId === connectionId)
    return hit?.environmentId ?? connectionId
  } catch {
    return connectionId
  }
}

/**
 * Start live bash output for a tool_use. Remote → node tail watch / readFile RPC.
 * Local → desktop fs.watch path. Returns a stop function.
 */
export function startBashOutputLive(opts: StartBashOutputLiveOptions): () => void {
  const { toolUseId, outputPath, projectKey } = opts
  stopBashOutputLive(toolUseId)

  const remote = projectKey ? parseRemoteProjectKey(projectKey) : null
  if (!remote) {
    void window.app.watchBashOutput(toolUseId, outputPath)
    return () => {
      void window.app.unwatchBashOutput(toolUseId)
    }
  }

  const projectId =
    opts.projectId ?? useAppStore.getState().currentProjectId ?? null
  if (!projectId) {
    // No project id yet — cannot route workspace RPC; leave empty live state.
    pushBashOutput(toolUseId, '', false, outputPath)
    return () => {}
  }

  const relativePath = toToolOutputRelativePath(remote.path, outputPath)
  if (!relativePath) {
    // Outside project/temp — path-security rejection (mirror node).
    pushBashOutput(toolUseId, '', true, outputPath)
    return () => {}
  }

  const port = opts.port ?? createEnvironmentBashTailPort()
  if (!port) {
    pushBashOutput(toolUseId, '', false, outputPath)
    return () => {}
  }

  let stopped = false
  let accumulated = ''
  let stableTimer: ReturnType<typeof setTimeout> | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let watchId: string | null = null
  const pollMs = opts.pollIntervalMs ?? DEFAULT_POLL_MS

  const clearTimers = () => {
    if (stableTimer) clearTimeout(stableTimer)
    stableTimer = null
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    clearTimers()
    activeRemote.delete(toolUseId)
    const id = watchId
    watchId = null
    if (id) void port.stop({ watchId: id }).catch(() => {})
  }

  void (async () => {
    try {
      const environmentId =
        opts.environmentId ?? (await resolveRemoteEnvironmentId(remote.connectionId))
      const started = await port.start({
        project: { environmentId, projectId },
        relativePath,
        offset: 0,
      })
      if (stopped) {
        await port.stop({ watchId: started.watchId }).catch(() => {})
        return
      }
      watchId = started.watchId
      activeRemote.set(toolUseId, { stop, watchId: started.watchId, port })

      const tick = async () => {
        if (stopped || !watchId) return
        try {
          const polled = await port.poll({ watchId })
          if (stopped) return
          const chunk = decodeTailContent(polled.content, polled.encoding)
          if (chunk) {
            accumulated += chunk
            pushBashOutput(toolUseId, accumulated, false, outputPath)
            if (stableTimer) clearTimeout(stableTimer)
            stableTimer = setTimeout(() => {
              if (stopped) return
              pushBashOutput(toolUseId, accumulated, true, outputPath)
            }, STABLE_TIMEOUT_MS)
          }
        } catch {
          /* file may not exist yet; keep polling */
        }
      }

      await tick()
      if (!stopped) {
        pollTimer = setInterval(() => {
          void tick()
        }, pollMs)
      }
    } catch {
      if (!stopped) pushBashOutput(toolUseId, '', true, outputPath)
      stop()
    }
  })()

  return stop
}

export function stopBashOutputLive(toolUseId: string): void {
  const remote = activeRemote.get(toolUseId)
  if (remote) {
    remote.stop()
    return
  }
  void window.app.unwatchBashOutput?.(toolUseId)
}

export function stopAllBashOutputLive(): void {
  for (const id of [...activeRemote.keys()]) stopBashOutputLive(id)
}
