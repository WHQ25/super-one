import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * One build per cache key, however many callers ask for it at once.
 *
 * Two callers wanting the same helper is the normal case, not a corner: attaching to
 * a device and starting the Simulator watcher happen in the same breath, and on a
 * cold cache both would otherwise run `build.sh` into the same directory and clobber
 * each other's object files — observed as `input file 'OrientationBridge.o' was
 * modified during the build`, which fails the build for BOTH of them.
 */
const buildFlights = new Map<string, Promise<string>>()

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

  const flight = buildFlights.get(outputDir)
    ?? build(sourceRoot, identity.developerDirectory, outputDir, binary)
      .finally(() => { buildFlights.delete(outputDir) })
  buildFlights.set(outputDir, flight)
  return flight
}

/**
 * Build into a scratch directory and move it into place.
 *
 * The move is what makes `existsSync(binary)` a truthful reading: a directory under
 * the cache key either does not exist or holds a finished build, never a link that is
 * still being written. Belt to the in-process single flight's braces — that one
 * cannot see a second SuperOne (a dev build beside an installed one) aimed at the
 * same cache.
 */
async function build(
  sourceRoot: string,
  developerDirectory: string,
  outputDir: string,
  binary: string,
): Promise<string> {
  const scratch = `${outputDir}.building-${randomUUID().slice(0, 8)}`
  mkdirSync(scratch, { recursive: true, mode: 0o700 })
  try {
    await execText('/bin/bash', [join(sourceRoot, 'build.sh'), scratch], {
      ...process.env,
      DEVELOPER_DIR: developerDirectory,
    })
    if (!existsSync(join(scratch, 'superone-ios-simulator-helper'))) {
      throw new Error('iOS Simulator helper build finished without a binary.')
    }
    try {
      renameSync(scratch, outputDir)
    } catch {
      // Something is already sitting on the key. A finished build is another process
      // that won the same race, and its output is by construction identical -- use
      // it. Anything else is rubble from a build that died partway, and leaving it
      // would block every future build of this key forever, so clear the slot.
      if (!existsSync(binary)) {
        rmSync(outputDir, { recursive: true, force: true })
        renameSync(scratch, outputDir)
      }
    }
    return binary
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
