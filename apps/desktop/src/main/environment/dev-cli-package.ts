import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PACK_SCRIPT = join('scripts', 'pack-npm.ts')

export interface DevCliPackage {
  /** Local `npm pack` tarball of `@super-one/cli` baked for the dev channel. */
  path: string
  version: string
  /** Delete the local tarball once it is installed (or the install failed). */
  release: () => Promise<void>
}

/** `apps/cli` of this checkout; the app path is `apps/desktop` or its `out/main`. */
function cliSourceRoot(): string | null {
  if (app.isPackaged) return null
  const appPath = app.getAppPath()
  return [resolve(appPath, '../cli'), resolve(appPath, '../../../cli')]
    .find((dir) => existsSync(join(dir, PACK_SCRIPT))) ?? null
}

/**
 * Pack `@super-one/cli` from this checkout, baked for the dev channel. Nothing
 * is published for dev, so a dev desktop deploys the code under development;
 * the host's npm installs the native and Agent SDK dependencies, exactly as
 * for a published release.
 */
export async function packDevCli(): Promise<DevCliPackage> {
  const cliRoot = cliSourceRoot()
  if (!cliRoot) {
    throw Object.assign(
      new Error(
        'The dev node channel deploys the CLI from source, so packaged dev builds cannot install or redeploy ' +
          'remote nodes; run the desktop from a SuperOne checkout (bun run dev).',
      ),
      { code: 'failed_precondition' },
    )
  }
  // Desktop launches may lack the login PATH that holds bun and npm. Lazy: the
  // logger it pulls in breaks unit tests that partially mock electron.
  const { ensureShellPath } = await import('../shell-path')
  await ensureShellPath()
  // Per call: pack-npm empties its output, so concurrent deploys must not share one.
  const outDir = await mkdtemp(join(tmpdir(), 'superone-dev-cli-'))
  const release = () => rm(outDir, { recursive: true, force: true })
  try {
    await execFileAsync(
      'bun',
      ['run', 'pack:npm', '--variant', 'dev', '--out', outDir, '--dry-run'],
      { cwd: cliRoot, timeout: 5 * 60_000, maxBuffer: 16 * 1024 * 1024 },
    )
  } catch (err) {
    await release()
    const stderr = (err as { stderr?: string }).stderr?.trim()
    throw new Error(`dev CLI pack failed: ${(stderr || (err as Error).message).slice(-800)}`)
  }
  const tarball = readdirSync(outDir).find((name) => /^super-one-cli-.+\.tgz$/.test(name))
  if (!tarball) {
    await release()
    throw new Error('dev CLI pack produced no tarball')
  }
  return { path: join(outDir, tarball), version: tarball.slice('super-one-cli-'.length, -'.tgz'.length), release }
}
