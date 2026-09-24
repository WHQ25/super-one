import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { shellQuote } from '../environment/ssh-bootstrap'

/**
 * The Node executable dsh's PTC runtime starts `run_code` programs and
 * workflows in.
 *
 * `dsh-ptc-runtime-node` defaults to `process.execPath`, which inside Electron
 * is the app itself: launched without `ELECTRON_RUN_AS_NODE` it would open a
 * second SuperOne instead of running a script. And the runtime builds the
 * child's environment itself — it clears every inherited variable except a
 * short startup list — so the flag cannot be passed through the environment.
 *
 * On POSIX the answer is a two-line launcher that sets the flag and `exec`s the
 * Electron binary with the arguments dsh chose; `exec` keeps the pid, so dsh's
 * process management and the sandbox wrap the real interpreter. It is written
 * under `userData` because the app bundle is read-only once packaged, and
 * rewritten only when its text differs (the app moved, or was updated).
 *
 * Windows has no shebang launcher dsh could spawn directly, so it uses the
 * `node` on `PATH`; `run_code` and workflows fail with a clear error on a
 * machine without one, and every other tool is unaffected.
 * @param dir - where to keep the launcher.
 * @param electronPath - the Electron binary (`process.execPath`).
 * @param platform - the host platform.
 * @returns the executable to hand to `dsh-ptc-runtime-node`.
 */
export async function ensurePtcNodeLauncher(
  dir: string,
  electronPath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  if (platform === 'win32') return 'node'
  const launcher = join(dir, 'node')
  const script = `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shellQuote(electronPath)} "$@"\n`
  const current = await readFile(launcher, 'utf8').catch(() => null)
  if (current !== script) {
    await mkdir(dir, { recursive: true })
    await writeFile(launcher, script, { mode: 0o755 })
  }
  // `mode` applies only when the file is created; an existing copy that lost
  // its execute bit would otherwise fail every run with EACCES.
  await chmod(launcher, 0o755)
  return launcher
}
