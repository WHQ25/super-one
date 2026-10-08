/**
 * Static machine facts for `descriptor.machine`: OS, CPU, memory, GPUs and the
 * developer toolchains on PATH. Collected once per process — a node restart or
 * upgrade refreshes it — and never fabricated: a fact the host cannot read is
 * omitted.
 */

import { execFile } from 'node:child_process'
import { accessSync, constants, readFileSync } from 'node:fs'
import { cpus, platform, release, totalmem, version as kernelVersion } from 'node:os'
import { delimiter, join } from 'node:path'
import type { EnvironmentMachine, EnvironmentToolchain } from '@superone/shared/environment'

const COMMAND_TIMEOUT_MS = 5_000

/** Combined stdout + stderr of a successful run, or null when it failed. */
export type RunCommand = (file: string, args: string[]) => Promise<string | null>

const runCommand: RunCommand = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: COMMAND_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve(err ? null : `${stdout}\n${stderr}`),
    )
  })

/** Toolchains worth knowing when choosing a machine, with their version flag. */
const TOOLCHAINS: ReadonlyArray<{ name: string; args: string[]; os?: NodeJS.Platform }> = [
  { name: 'git', args: ['--version'] },
  { name: 'docker', args: ['--version'] },
  { name: 'xcodebuild', args: ['-version'], os: 'darwin' },
  { name: 'node', args: ['--version'] },
  { name: 'bun', args: ['--version'] },
  { name: 'python3', args: ['--version'] },
  { name: 'go', args: ['version'] },
  { name: 'rustc', args: ['--version'] },
  { name: 'java', args: ['-version'] },
]

/** First dotted version number in a `--version` banner. */
export function parseToolVersion(output: string): string | undefined {
  return /(\d+\.\d+(?:\.\d+)?)/.exec(output)?.[1]
}

/** Model names from `system_profiler SPDisplaysDataType -json`. */
export function parseMacDisplays(json: string): string[] {
  try {
    const items = (JSON.parse(json) as { SPDisplaysDataType?: Array<{ sppci_model?: unknown }> }).SPDisplaysDataType ?? []
    return items.map((item) => (typeof item.sppci_model === 'string' ? item.sppci_model.trim() : '')).filter(Boolean)
  } catch {
    return []
  }
}

/** Display controllers from plain `lspci` output. */
export function parseLspci(output: string): string[] {
  const out: string[] = []
  for (const line of output.split('\n')) {
    const match = /^\S+\s+(?:VGA compatible controller|3D controller|Display controller):\s*(.+)$/.exec(line.trim())
    if (match) out.push(match[1].replace(/\s*\(rev [0-9a-f]+\)$/i, '').trim())
  }
  return out
}

/** `PRETTY_NAME` from `/etc/os-release`. */
export function parseOsRelease(text: string): string | undefined {
  const match = /^PRETTY_NAME=(.*)$/m.exec(text)
  const value = match?.[1].trim().replace(/^(["'])(.*)\1$/, '$2').trim()
  return value || undefined
}

function lines(output: string | null): string[] {
  return (output ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

/** Absolute path of `name` on PATH, or null. Avoids spawning tools that are absent. */
function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const exts = platform() === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, name + ext)
      try {
        accessSync(candidate, constants.X_OK)
        return candidate
      } catch {
        /* keep looking */
      }
    }
  }
  return null
}

async function readOs(run: RunCommand): Promise<string> {
  switch (platform()) {
    case 'darwin': {
      const version = lines(await run('sw_vers', ['-productVersion']))[0]
      return version ? `macOS ${version}` : `macOS (Darwin ${release()})`
    }
    case 'win32':
      return `${kernelVersion()} ${release()}`
    default: {
      let pretty: string | undefined
      try {
        pretty = parseOsRelease(readFileSync('/etc/os-release', 'utf8'))
      } catch {
        /* not every distro ships os-release */
      }
      return pretty ?? `Linux ${release()}`
    }
  }
}

async function readGpus(run: RunCommand): Promise<string[]> {
  switch (platform()) {
    case 'darwin': {
      const json = await run('system_profiler', ['SPDisplaysDataType', '-json'])
      return json ? parseMacDisplays(json) : []
    }
    case 'win32':
      return lines(
        await run('powershell', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name',
        ]),
      )
    default:
      return findOnPath('lspci') ? parseLspci((await run('lspci', [])) ?? '') : []
  }
}

async function readToolchains(run: RunCommand): Promise<EnvironmentToolchain[]> {
  const os = platform()
  // Without the Command Line Tools, macOS's /usr/bin git/python3/… are shims
  // that pop an install dialog instead of answering.
  const macShimsLive = os !== 'darwin' || (await run('xcode-select', ['-p'])) !== null
  const found = await Promise.all(
    TOOLCHAINS.filter((tool) => !tool.os || tool.os === os).map(async (tool): Promise<EnvironmentToolchain | null> => {
      const path = findOnPath(tool.name)
      if (!path || (!macShimsLive && path.startsWith('/usr/bin/'))) return null
      const output = await run(path, tool.args)
      if (output === null) return null
      const version = parseToolVersion(output)
      return version ? { name: tool.name, version } : { name: tool.name }
    }),
  )
  return found.filter((tool): tool is EnvironmentToolchain => tool !== null)
}

/** Collect machine facts now. Never rejects; unreadable facts are omitted. */
export async function collectMachineInfo(run: RunCommand = runCommand): Promise<EnvironmentMachine> {
  const cpuList = cpus()
  const [os, gpus, toolchains] = await Promise.all([
    readOs(run),
    readGpus(run).catch(() => []),
    readToolchains(run).catch(() => []),
  ])
  const cpuModel = cpuList[0]?.model.replace(/\s+/g, ' ').trim()
  return {
    os,
    ...(cpuModel ? { cpuModel } : {}),
    cpuCores: cpuList.length,
    memoryBytes: totalmem(),
    ...(gpus.length ? { gpus } : {}),
    toolchains,
  }
}

let cached: Promise<EnvironmentMachine> | null = null

/**
 * Process-lifetime machine facts. Call early to warm it: the first descriptor
 * read otherwise waits for the probes (around a second on macOS). Hosts whose
 * PATH is resolved late (desktop login shell) should call it after that.
 */
export function getMachineInfo(): Promise<EnvironmentMachine> {
  cached ??= collectMachineInfo()
  return cached
}
