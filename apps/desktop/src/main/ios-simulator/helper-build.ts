import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

function execText(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', env, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message).trim()))
        return
      }
      resolve(stdout.trim())
    })
  })
}

export function resolveIosSimulatorHelperSourceRoot(): string | null {
  const devRoot = fileURLToPath(new URL('../../../native/ios-simulator-helper', import.meta.url))
  const candidates = [
    process.env.SUPERONE_IOS_HELPER_SOURCE,
    process.resourcesPath ? join(process.resourcesPath, 'ios-simulator-helper') : undefined,
    devRoot,
    join(process.cwd(), 'native/ios-simulator-helper'),
    join(process.cwd(), 'apps/desktop/native/ios-simulator-helper'),
  ].filter((value): value is string => Boolean(value))
  return candidates.find((candidate) => existsSync(join(candidate, 'build.sh'))) ?? null
}

/**
 * Every file the build actually consumes, walked rather than listed.
 *
 * A hand-written list silently stops covering a source file the moment one is added
 * or renamed: the key does not move, so the stale binary already in userData is
 * reused and the change appears to do nothing. Mirrors electron-builder's own
 * `build.sh` + `Sources/**` filter, so the two enumerations cannot disagree.
 */
function walk(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .flatMap((entry) => (entry.isDirectory()
      ? walk(join(directory, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`]))
}

function sourceHash(root: string): string {
  const hash = createHash('sha256')
  // Sorted so the key does not depend on directory order.
  const files = ['build.sh', ...walk(join(root, 'Sources')).map((name) => `Sources/${name}`)].sort()
  for (const relative of files) {
    hash.update(relative)
    hash.update(readFileSync(join(root, relative)))
  }
  return hash.digest('hex').slice(0, 16)
}

async function xcodeBuildIdentity(): Promise<{ build: string; developerDirectory: string }> {
  const [version, developerDirectory] = await Promise.all([
    execText('/usr/bin/xcodebuild', ['-version']),
    execText('/usr/bin/xcode-select', ['-p']),
  ])
  const build = version.split(/\r?\n/).find((line) => line.startsWith('Build version '))
    ?.slice('Build version '.length) ?? 'unknown'
  return { build, developerDirectory }
}

export async function ensureIosSimulatorHelper(cacheRoot: string): Promise<string> {
  if (process.platform !== 'darwin') throw new Error('iOS Simulator helper is macOS-only.')
  const sourceRoot = resolveIosSimulatorHelperSourceRoot()
  if (!sourceRoot) throw new Error('iOS Simulator helper sources were not found.')
  const identity = await xcodeBuildIdentity()
  const key = `${identity.build}-${process.arch}-${sourceHash(sourceRoot)}`
  const outputDir = join(cacheRoot, key)
  const binary = join(outputDir, 'superone-ios-simulator-helper')
  if (existsSync(binary)) return binary

  mkdirSync(outputDir, { recursive: true, mode: 0o700 })
  await execText('/bin/bash', [join(sourceRoot, 'build.sh'), outputDir], {
    ...process.env,
    DEVELOPER_DIR: identity.developerDirectory,
  })
  if (!existsSync(binary)) throw new Error('iOS Simulator helper build finished without a binary.')
  return binary
}
