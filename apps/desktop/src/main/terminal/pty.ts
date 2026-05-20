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

const DEFAULT_REGION_BY_LANG: Record<string, string> = {
  zh: 'CN',
  ja: 'JP',
  ko: 'KR',
  en: 'US',
  fr: 'FR',
  de: 'DE',
  es: 'ES',
  pt: 'BR',
  ru: 'RU',
  it: 'IT',
}

function getSystemUtf8Locale(): string {
  let bcp47 = ''
  try {
    const electron = nodeRequire('electron') as typeof import('electron')
    bcp47 = electron.app?.getLocale?.() ?? ''
  } catch {
    /* non-electron runtime (vitest) — keep bcp47 empty */
  }
  if (!bcp47) return 'en_US.UTF-8'
  const [langRaw, regionRaw] = bcp47.split(/[-_]/)
  const lang = langRaw.toLowerCase()
  const region = (regionRaw ?? DEFAULT_REGION_BY_LANG[lang] ?? lang.toUpperCase()).toUpperCase()
  return `${lang}_${region}.UTF-8`
}

export const nodePtySpawner: PtySpawner = {
  spawn(opts: PtySpawnOptions): PtyLike {
    const { spawn } = nodeRequire('node-pty') as typeof import('node-pty')
    const baseEnv: Record<string, string> = { ...process.env, ...opts.env } as Record<string, string>
    const env: Record<string, string> = { ...baseEnv, TERM: 'xterm-256color' }
    if (process.platform !== 'win32') {
      if (!env.LANG && !env.LC_ALL) env.LANG = getSystemUtf8Locale()
      if (!env.LC_CTYPE) env.LC_CTYPE = 'UTF-8'
    }
    const proc = spawn(opts.shell || defaultShell(), [], {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env,
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
