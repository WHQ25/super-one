import { accessSync, constants } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { fixPath } from '../agent/resolve-cli'
import { BUILTIN_ACP_AGENTS, type AcpAgentDefinition } from './agent-catalog'

const execFileAsync = promisify(execFile)

export interface DetectedAcpAgent {
  id: string
  name: string
  installed: boolean
  commandPreview: string
  installHint?: string
  resolvedPath?: string
}

let pathReady = false

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Extra dirs Electron often misses even after shell PATH fix. */
function knownBinDirs(): string[] {
  const home = homedir()
  const dirs = [
    join(home, '.grok', 'bin'),
    join(home, '.opencode', 'bin'),
    join(home, '.local', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]
  if (process.platform === 'darwin') {
    dirs.push('/opt/homebrew/sbin', '/usr/local/sbin')
  }
  return dirs
}

function ensureSearchPath(): string {
  if (!pathReady) {
    fixPath()
    pathReady = true
  }
  const current = process.env.PATH ?? ''
  const parts = current.split(':').filter(Boolean)
  const seen = new Set(parts)
  for (const dir of knownBinDirs()) {
    if (!seen.has(dir)) {
      parts.unshift(dir)
      seen.add(dir)
    }
  }
  const merged = parts.join(':')
  process.env.PATH = merged
  return merged
}

function resolveFromKnownDirs(command: string): string | null {
  for (const dir of knownBinDirs()) {
    const candidate = join(dir, command)
    if (isExecutable(candidate)) return candidate
  }
  return null
}

function resolveFromPathEnv(command: string, pathEnv: string): string | null {
  for (const dir of pathEnv.split(':').filter(Boolean)) {
    const candidate = join(dir, command)
    if (isExecutable(candidate)) return candidate
  }
  return null
}

async function whichCommand(command: string, pathEnv: string): Promise<string | null> {
  if (!command) return null
  if (command.includes('/') || command.includes('\\')) {
    return isExecutable(command) ? command : null
  }

  const fromPath = resolveFromPathEnv(command, pathEnv)
  if (fromPath) return fromPath

  const fromKnown = resolveFromKnownDirs(command)
  if (fromKnown) return fromKnown

  // Last resort: shell which/where (slow when missing). Keep timeout short.
  const whichBin = process.platform === 'win32' ? 'where' : 'which'
  try {
    const { stdout } = await execFileAsync(whichBin, [command], {
      timeout: 400,
      env: { ...process.env, PATH: pathEnv },
    })
    const first = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
    if (first && isExecutable(first)) return first
  } catch {
    /* not found */
  }
  return null
}

export async function detectAgent(def: AcpAgentDefinition): Promise<DetectedAcpAgent> {
  const pathEnv = ensureSearchPath()
  const resolvedPath = await whichCommand(def.command, pathEnv)
  return {
    id: def.id,
    name: def.name,
    installed: !!resolvedPath,
    commandPreview: [def.command, ...def.args].join(' '),
    installHint: def.installHint,
    resolvedPath: resolvedPath ?? undefined,
  }
}

export async function detectBuiltinAgents(): Promise<DetectedAcpAgent[]> {
  ensureSearchPath()
  return Promise.all(BUILTIN_ACP_AGENTS.map((def) => detectAgent(def)))
}
