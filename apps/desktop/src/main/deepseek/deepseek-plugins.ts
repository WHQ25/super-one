/**
 * Main-process service behind the dsh plugin settings surface.
 *
 * Every mutation follows the same two beats — **write the registry, then
 * reconcile the running tree** — because the reconcile is what makes an install
 * or a toggle take effect without a restart. Keeping both beats here, rather
 * than in each IPC handler, is what stops a future mutation from landing on
 * disk and never reaching the process.
 */

import {
  installPluginFromDirectory,
  installPluginFromNpm,
  installPluginFromTarball,
  listBundledDshPlugins,
  readPluginRegistry,
  setPluginDisabled,
  uninstallPlugin,
  type InstallResult,
} from '@superone/deepseek'
import type {
  DshPluginInfo,
  DshPluginInstallResult,
  DshPluginInstallSource,
  DshPluginList,
} from '@superone/shared/agent-types'
import { dshPluginRoot, peekDeepseekRuntime, shippedPresetRoot } from './deepseek-runtime-host'

/**
 * List installed plugins, annotated with their live state.
 *
 * Reads the registry directly and only asks a runtime that already exists:
 * opening the settings page must not boot dsh. With no runtime the status is
 * `null` — "unknown", which the UI must not render as a failure.
 * @returns the roster, any registry problem, and the root path.
 */
export async function listDshPlugins(): Promise<DshPluginList> {
  const root = dshPluginRoot()
  const [registry, bundled] = await Promise.all([
    readPluginRegistry(root),
    listBundledDshPlugins(shippedPresetRoot()),
  ])

  // `syncPlugins` is idempotent — an unchanged row matches its fingerprint and
  // is not remounted — so asking for fresh status costs nothing.
  const runtime = await peekDeepseekRuntime()
  const report = await runtime?.syncPlugins()
  const live = new Map(report?.outcomes.map((outcome) => [outcome.row.id, outcome]) ?? [])

  const plugins: DshPluginInfo[] = registry.plugins.map((row) => {
    const outcome = live.get(row.id)
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      disabled: row.disabled === true,
      status: runtime ? (outcome?.status ?? null) : null,
      ...(outcome?.reason !== undefined ? { reason: outcome.reason } : {}),
    }
  })

  const problem = registry.problem ?? report?.registryProblem
  return problem === undefined
    ? { bundled, plugins, root }
    : { bundled, plugins, root, problem }
}

/** Push the registry into the running tree, when one exists. */
async function reconcile(): Promise<void> {
  const runtime = await peekDeepseekRuntime()
  await runtime?.syncPlugins()
}

/** Project an install result onto the wire shape the renderer renders. */
function projectInstall(result: InstallResult): DshPluginInstallResult {
  return {
    id: result.row.id,
    name: result.row.name,
    version: result.row.version,
    unmetDependencies: result.unmetDependencies,
    mismatched: result.lockstep.mismatched.map((entry) => ({ ...entry })),
  }
}

/**
 * Install a plugin from any supported source, then make it live.
 *
 * `trust: 'granted'` is passed here because reaching this function *is* the
 * user's grant — the renderer will not call it without showing what a plugin may
 * do. The install API demands the value so that a new caller cannot be written
 * that silently skips the question.
 * @param source - where to read the package from.
 * @param force - install despite an incompatible peer range.
 * @returns what was recorded, plus what the user should be warned about.
 */
export async function installDshPlugin(
  source: DshPluginInstallSource,
  force = false,
): Promise<DshPluginInstallResult> {
  const root = dshPluginRoot()
  const options = { trust: 'granted' as const, force }
  let result: InstallResult
  switch (source.kind) {
    case 'directory':
      result = await installPluginFromDirectory(root, source.path, options)
      break
    case 'tarball':
      result = await installPluginFromTarball(root, source.path, options)
      break
    case 'npm':
      result = await installPluginFromNpm(root, source.name, {
        ...options,
        ...(source.version !== undefined ? { version: source.version } : {}),
      })
      break
  }
  await reconcile()
  return projectInstall(result)
}

/**
 * Enable or disable a row, then make the change live.
 * @param id - the row id.
 * @param disabled - the new state.
 * @returns whether a row with that id existed.
 */
export async function setDshPluginDisabled(id: string, disabled: boolean): Promise<boolean> {
  const found = await setPluginDisabled(dshPluginRoot(), id, disabled)
  if (found) await reconcile()
  return found
}

/**
 * Remove a plugin and take it back out of the running tree.
 * @param id - the row id.
 * @returns whether a row with that id existed.
 */
export async function uninstallDshPlugin(id: string): Promise<boolean> {
  const removed = await uninstallPlugin(dshPluginRoot(), id)
  if (removed) await reconcile()
  return removed !== null
}
