import { spawn, type ChildProcess } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'

export interface SshForwardOptions {
  /** OpenSSH destination: user@host or Host alias from ~/.ssh/config */
  destination: string
  /** Remote node loopback port (default 7788). */
  remotePort?: number
  /** Local bind port; 0 = ephemeral. */
  localPort?: number
  /** Extra ssh args (e.g. -J jump, -i identity). */
  extraArgs?: string[]
  /** ssh binary path (default "ssh"). */
  sshPath?: string
  /** Maximum time to wait for the local forwarded listener to bind. */
  readyTimeoutMs?: number
}

export interface SshForwardHandle {
  localPort: number
  localBaseUrl: string
  process: ChildProcess
  stop(): void
}

/** Find an ephemeral free TCP port on 127.0.0.1. */
export async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        server.close()
        reject(new Error('failed to allocate port'))
        return
      }
      const port = addr.port
      server.close((err) => (err ? reject(err) : resolve(port)))
    })
    server.on('error', reject)
  })
}

/**
 * Establish `ssh -N -L localPort:127.0.0.1:remotePort destination`.
 * Closing the tunnel disconnects the client but must never stop the remote node.
 */
export async function startSshLocalForward(opts: SshForwardOptions): Promise<SshForwardHandle> {
  const remotePort = opts.remotePort ?? 7788
  const localPort = opts.localPort && opts.localPort > 0 ? opts.localPort : await findFreePort()
  const sshPath = opts.sshPath || 'ssh'
  const args = [
    '-N',
    '-L',
    `${localPort}:127.0.0.1:${remotePort}`,
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'BatchMode=yes',
    ...(opts.extraArgs ?? []),
    opts.destination,
  ]

  const child = spawn(sshPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  })

  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-8_000)
  })

  // The local listener is the first reliable readiness signal. The node health
  // check is performed by bootstrap callers after this function resolves.
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        child.removeListener('error', onError)
        child.removeListener('exit', onExit)
        if (error) reject(error)
        else resolve()
      }
      const onError = (error: Error): void => finish(error)
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        finish(
          new Error(
            `ssh forward exited before local port ${localPort} was ready code=${code} signal=${signal} ${stderr}`.trim(),
          ),
        )
      }
      child.once('error', onError)
      child.once('exit', onExit)
      void waitForLocalPort(localPort, opts.readyTimeoutMs ?? 15_000).then(
        () => finish(),
        (error) => finish(error instanceof Error ? error : new Error(String(error))),
      )
    })
  } catch (error) {
    if (!child.killed) child.kill('SIGTERM')
    const message = error instanceof Error ? error.message : String(error)
    const sshDetail = stderr.trim() ? ` SSH reported: ${stderr.trim()}` : ''
    throw Object.assign(
      new Error(
        `${message}.${sshDetail} The SSH connection may have been rate-limited or refused.`,
      ),
      { cause: error },
    )
  }

  return {
    localPort,
    localBaseUrl: `http://127.0.0.1:${localPort}`,
    process: child,
    stop() {
      if (!child.killed) child.kill('SIGTERM')
    },
  }
}

/** Wait until an SSH local-forward listener accepts a TCP connection. */
export async function waitForLocalPort(
  port: number,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError = 'not listening'
  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now()
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection({ host: '127.0.0.1', port })
        const timer = setTimeout(
          () => {
            socket.destroy()
            reject(new Error('connection timeout'))
          },
          Math.min(500, remainingMs),
        )
        socket.once('connect', () => {
          clearTimeout(timer)
          socket.destroy()
          resolve()
        })
        socket.once('error', (error) => {
          clearTimeout(timer)
          socket.destroy()
          reject(error)
        })
      })
      return
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    const delayMs = Math.min(100, deadline - Date.now())
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  throw new Error(
    `local SSH forward port ${port} did not become ready within ${timeoutMs}ms: ${lastError}`,
  )
}

/**
 * Stream a local file to a remote path over SSH.
 *
 * Uses `cat > path` on an existing SSH session rather than scp/sftp so it works
 * on hosts where only a shell is available, and inherits the same
 * `~/.ssh/config` / agent behaviour as every other call here.
 */
export async function sshUpload(input: {
  destination: string
  localPath: string
  remotePath: string
  /** Optional shell command used to prepare the destination before reading stdin. */
  remoteCommand?: string
  extraArgs?: string[]
  sshPath?: string
  timeoutMs?: number
  onProgress?: (sentBytes: number, totalBytes: number) => void
}): Promise<{ bytes: number }> {
  const sshPath = input.sshPath || 'ssh'
  const total = (await stat(input.localPath)).size
  const args = [
    '-o',
    'BatchMode=yes',
    ...(input.extraArgs ?? []),
    input.destination,
    input.remoteCommand ?? `cat > ${shellQuoteArg(input.remotePath)}`,
  ]

  return new Promise((resolve, reject) => {
    const child = spawn(sshPath, args, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env })
    let stderr = ''
    let sent = 0
    const timer = setTimeout(
      () => {
        child.kill('SIGTERM')
        reject(new Error('ssh upload timeout'))
      },
      input.timeoutMs ?? 300_000,
    )

    child.stderr.on('data', (c) => {
      stderr += c.toString()
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ bytes: total })
      else reject(new Error(`ssh upload failed (code ${code}): ${stderr.trim()}`))
    })

    const source = createReadStream(input.localPath)
    source.on('data', (chunk) => {
      sent += chunk.length
      input.onProgress?.(sent, total)
    })
    source.on('error', (err) => {
      clearTimeout(timer)
      child.kill('SIGTERM')
      reject(err)
    })
    source.pipe(child.stdin)
  })
}

/** Single-quote a value for a remote POSIX shell. */
function shellQuoteArg(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Run a one-shot remote command over SSH (bootstrap / pair-create / install).
 * stdout is returned for in-memory parsing — callers must not log secrets.
 */
export async function sshCapture(input: {
  destination: string
  command: string
  extraArgs?: string[]
  sshPath?: string
  timeoutMs?: number
}): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const sshPath = input.sshPath || 'ssh'
  const args = ['-o', 'BatchMode=yes', ...(input.extraArgs ?? []), input.destination, input.command]
  return new Promise((resolve, reject) => {
    const child = spawn(sshPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => {
      stdout += c.toString()
    })
    child.stderr.on('data', (c) => {
      stderr += c.toString()
    })
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('ssh command timeout'))
    }, input.timeoutMs ?? 60_000)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code })
    })
  })
}
