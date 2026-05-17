import { createRequire } from 'node:module'

const nodeRequire = createRequire(import.meta.url)

export interface PtyLike {
  write(data: string): void
  resize(cols: number, rows: number): void
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number; signal: number | null }) => void): void
  kill(): void
}

export interface PtySpawnOptions {
  cwd: string
  cols: number
  rows: number
  env?: Record<string, string>
  shell?: string
}

export interface PtySpawner {
  spawn(opts: PtySpawnOptions): PtyLike
}

function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC || 'powershell.exe'
  return process.env.SHELL || '/bin/bash'
}

export const nodePtySpawner: PtySpawner = {
  spawn(opts: PtySpawnOptions): PtyLike {
    const { spawn } = nodeRequire('node-pty') as typeof import('node-pty')
    const proc = spawn(opts.shell || defaultShell(), [], {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env, TERM: 'xterm-256color' } as Record<string, string>,
    })
    return {
      write: (data) => proc.write(data),
      resize: (cols, rows) => proc.resize(cols, rows),
      onData: (cb) => {
        proc.onData(cb)
      },
      onExit: (cb) => {
        proc.onExit(({ exitCode, signal }) => cb({ exitCode, signal: signal ?? null }))
      },
      kill: () => proc.kill(),
    }
  },
}
