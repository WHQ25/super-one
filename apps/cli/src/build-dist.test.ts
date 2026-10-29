import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { launcherScript } from '../scripts/build-dist'
import { npmLauncherSource } from '../scripts/pack-npm'

const NODE_20 = '/Users/wuhangqi25/.nvm/versions/node/v20.18.2/bin/node'
const NODE_22 = '/Users/wuhangqi25/.nvm/versions/node/v22.13.1/bin/node'

function writeFakeNode(binPath: string, version: string): void {
  mkdirSync(dirname(binPath), { recursive: true })
  writeFileSync(
    binPath,
    [
      '#!/bin/sh',
      `ver='${version}'`,
      'expr=${2-}',
      'case "$1" in',
      "  -v) printf 'v%s\\n' \"$ver\" ;;",
      '  -p)',
      '    case "$expr" in',
      "      *split*) printf '%s\\n' \"${ver%%.*}\" ;;",
      "      *) printf '%s\\n' \"$ver\" ;;",
      '    esac',
      '    ;;',
      '  *)',
      '    if [ -n "$SUPERONE_NODE_EXEC_MARK" ]; then : > "$SUPERONE_NODE_EXEC_MARK"; fi',
      '    exit 0',
      '    ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n'),
  )
  chmodSync(binPath, 0o755)
}

function runUploadLauncher(version: string): { status: number; stderr: string; executed: boolean } {
  const root = mkdtempSync(join(tmpdir(), 'superone-launcher-'))
  const mark = join(root, 'executed')
  try {
    mkdirSync(join(root, 'bin'))
    mkdirSync(join(root, 'lib'))
    const launcher = join(root, 'bin', 'superone')
    writeFileSync(launcher, launcherScript(false))
    chmodSync(launcher, 0o755)
    writeFileSync(join(root, 'lib', 'cli.mjs'), 'throw new Error("loaded")\n')
    const nodeDir = join(root, 'fake-node')
    writeFakeNode(join(nodeDir, 'node'), version)
    try {
      execFileSync(launcher, ['version'], {
        env: {
          ...process.env,
          PATH: `${nodeDir}:/usr/bin:/bin`,
          SUPERONE_NODE_EXEC_MARK: mark,
        },
        encoding: 'utf8',
      })
      return { status: 0, stderr: '', executed: existsSync(mark) }
    } catch (error) {
      const failed = error as { status?: number; stderr?: string }
      return {
        status: failed.status ?? 1,
        stderr: String(failed.stderr ?? ''),
        executed: existsSync(mark),
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function runNpmLauncher(nodeBin: string): { status: number; stderr: string; stdout: string } {
  const root = mkdtempSync(join(tmpdir(), 'superone-npm-launcher-'))
  try {
    mkdirSync(join(root, 'bin'))
    mkdirSync(join(root, 'lib'))
    const launcher = join(root, 'bin', 'superone.mjs')
    writeFileSync(launcher, npmLauncherSource())
    chmodSync(launcher, 0o755)
    writeFileSync(join(root, 'lib', 'cli.mjs'), 'console.log("LOADED")\n')
    try {
      const stdout = execFileSync(nodeBin, [launcher, 'version'], {
        encoding: 'utf8',
        env: process.env,
      })
      return { status: 0, stderr: '', stdout }
    } catch (error) {
      const failed = error as { status?: number; stderr?: string; stdout?: string }
      return {
        status: failed.status ?? 1,
        stderr: String(failed.stderr ?? ''),
        stdout: String(failed.stdout ?? ''),
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('upload launcher node floor', () => {
  it.each(['20.19.2', '22.12.9'])('rejects Node %s before loading the bundle', (version) => {
    const result = runUploadLauncher(version)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Node.js 22.13.0+ required')
    expect(result.executed).toBe(false)
  })

  it.each(['22.13.0', '22.23.4', '24.0.0'])('starts the bundle on Node %s', (version) => {
    const result = runUploadLauncher(version)
    expect(result.status).toBe(0)
    expect(result.executed).toBe(true)
  })
})

describe('npm launcher node floor', () => {
  it('rejects the installed Node 20 runtime before loading the CLI', () => {
    const result = runNpmLauncher(NODE_20)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Node.js 22.13.0+ required')
    expect(result.stdout).not.toContain('LOADED')
  })

  it('loads the CLI on Node 22.13', () => {
    const result = runNpmLauncher(NODE_22)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('LOADED')
  })
})
