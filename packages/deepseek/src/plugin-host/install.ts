/**
 * Installing a third-party plugin into the plugin root.
 *
 * The first supported source is a local directory — a plugin you wrote, or one
 * you unpacked yourself. It is enough to exercise the whole chain (resolver ->
 * registry -> mount) with no network and no external package manager, and it is
 * the shape a plugin author needs while developing.
 *
 * Note what this deliberately does NOT do: run a package manager. dsh's own
 * `dsh plugin add` is a thin `pnpm` forwarder, which a packaged desktop app
 * cannot rely on. It also would not help — its activation test is the
 * `dsh.bundle` manifest field, and host-side capability plugins (`tool-*`,
 * `llm-*`, executors) do not declare one; they are plain packages that a
 * composition names as a row. Recording that row is what this module does
 * instead.
 */

import { cp, readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { x as extractTar } from 'tar'
import { createRequire } from 'node:module'
import { satisfies, validRange } from 'semver'
import { readPluginRegistry, updatePluginRegistry, type DshPluginRow } from './registry'
import { registerDshPluginRoot } from './resolver'

/** Resolve family peers against the app's own copies. */
const appRequire = createRequire(import.meta.url)

/** Specifier prefix whose versions must move in lockstep with the app. */
const DSH_FAMILY_PREFIX = '@deepseek-ai/'

/** The subset of a plugin's package.json this module reads. */
export interface PluginManifest {
  name: string
  version: string
  peerDependencies?: Record<string, string>
  /**
   * The plugin's own runtime dependencies. Read only to report them: nothing
   * here installs a dependency tree, so a plugin that declares any must bundle
   * them. Reported rather than refused — a stale or optional entry should not
   * block an otherwise working plugin.
   */
  dependencies?: Record<string, string>
}

/** One dsh peer whose declared range does not admit the app's copy. */
export interface PeerMismatch {
  name: string
  /** The range the plugin declared. */
  wanted: string
  /** The version the app actually carries. */
  actual: string
}

/** What the lockstep check found. */
export interface LockstepReport {
  /** Peers the app does not carry at all — the plugin cannot import them. */
  missing: string[]
  /** Peers present but outside the declared range. */
  mismatched: PeerMismatch[]
  /**
   * Peers whose declared range is not parseable semver, so nothing was proven.
   *
   * `workspace:^` is the common case: it is valid inside the plugin author's own
   * monorepo and gets rewritten at publish time, so a plugin installed from a
   * local working tree carries it verbatim. Reporting it as unchecked is honest;
   * treating it as a mismatch would block every locally-developed plugin.
   */
  unchecked: string[]
}

/** Whether a report describes something that will break at import time. */
export function lockstepBlocks(report: LockstepReport): boolean {
  return report.missing.length > 0 || report.mismatched.length > 0
}

/**
 * Read and validate the parts of a plugin's package.json this module needs.
 * @param dir - the plugin source directory.
 * @returns the manifest.
 * @throws when the manifest is absent, unparseable, or lacks name/version.
 */
export async function readPluginManifest(dir: string): Promise<PluginManifest> {
  const raw = await readFile(join(dir, 'package.json'), 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${dir}/package.json is not an object`)
  }
  const { name, version, peerDependencies, dependencies } = parsed as Record<string, unknown>
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`${dir}/package.json has no name`)
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`${dir}/package.json has no version`)
  }
  return {
    name,
    version,
    ...(peerDependencies && typeof peerDependencies === 'object' && !Array.isArray(peerDependencies)
      ? { peerDependencies: peerDependencies as Record<string, string> }
      : {}),
    ...(dependencies && typeof dependencies === 'object' && !Array.isArray(dependencies)
      ? { dependencies: dependencies as Record<string, string> }
      : {}),
  }
}

/**
 * Check a plugin's dsh peers against the copies the app carries.
 *
 * Only `@deepseek-ai/*` peers are checked: those are the ones the resolver hook
 * redirects, so those are the ones where the plugin gets a version it did not
 * choose. Everything else the plugin brings itself and owns.
 * @param manifest - the plugin's manifest.
 * @returns what the check found; see {@link lockstepBlocks}.
 */
export function checkPeerLockstep(manifest: PluginManifest): LockstepReport {
  const report: LockstepReport = { missing: [], mismatched: [], unchecked: [] }
  for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
    if (!name.startsWith(DSH_FAMILY_PREFIX)) continue
    let actual: string
    try {
      // Every dsh package maps './package.json' in its exports, which is what
      // makes this subpath resolvable at all.
      const pkg: unknown = JSON.parse(
        readFileSync(appRequire.resolve(`${name}/package.json`), 'utf8'),
      )
      actual = String((pkg as { version?: unknown }).version ?? '')
    } catch {
      report.missing.push(name)
      continue
    }
    if (validRange(range) === null) {
      report.unchecked.push(name)
      continue
    }
    // `includePrerelease` widens matching across prerelease tuples (a range
    // anchored at `0.1.0-rc.1` then admits `0.1.5-rc.1`), which is the forgiving
    // reading a fast-moving preview family needs.
    //
    // It does NOT rescue a range written against a release: `^0.1.0` means
    // `>=0.1.0`, and `0.1.0-rc.8` sorts BELOW `0.1.0`, so a plugin asking for
    // `^0.1.0` is genuinely asking for a version this build does not have. That
    // reads as a mismatch on purpose — see the test that pins it.
    if (!satisfies(actual, range, { includePrerelease: true })) {
      report.mismatched.push({ name, wanted: range, actual })
    }
  }
  return report
}

/** What an install attempt produced. */
export interface InstallResult {
  row: DshPluginRow
  lockstep: LockstepReport
  /**
   * Runtime dependencies the plugin declares that nothing here installs. A
   * non-empty list means the plugin only works if it bundled them.
   */
  unmetDependencies: string[]
}

/**
 * Acknowledgement that a plugin runs in the main process with full Node
 * privileges — it can read any file, spawn any process, and reach the network.
 * Installing one is closer to installing an editor extension than to opening a
 * page.
 *
 * Required rather than optional on purpose: the type is what stops a future
 * install path from being added that quietly skips asking the user.
 */
export type TrustGrant = 'granted'

/** Options shared by every install source. */
export interface InstallOptions {
  /** The user was shown what a plugin may do, and agreed. */
  trust: TrustGrant
  /** Install despite a blocking lockstep report. Default false. */
  force?: boolean
  /** Row id, when it should differ from the package name. */
  id?: string
  /** Config recorded on the row. */
  config?: Record<string, unknown>
}

/**
 * Copy a plugin directory into the plugin root and record its row.
 *
 * The destination is `<root>/node_modules/<name>`, which is what makes the
 * plugin resolvable by its own package name and puts it under the root the
 * resolver hook watches.
 * @param root - the plugin root directory.
 * @param sourceDir - the directory holding the plugin's package.json.
 * @param options - install behaviour.
 * @returns the recorded row and the lockstep report.
 * @throws when the manifest is unusable, or the lockstep check blocks and
 *   `force` was not set.
 */
export async function installPluginFromDirectory(
  root: string,
  sourceDir: string,
  options: InstallOptions,
): Promise<InstallResult> {
  const manifest = await readPluginManifest(sourceDir)
  const lockstep = checkPeerLockstep(manifest)
  if (lockstepBlocks(lockstep) && options.force !== true) {
    const problems = [
      ...lockstep.missing.map((name) => `${name} is not carried by this build`),
      ...lockstep.mismatched.map((m) => `${m.name} wants ${m.wanted}, this build has ${m.actual}`),
    ]
    throw new Error(`${manifest.name} is not compatible with this build: ${problems.join('; ')}`)
  }

  const destination = join(root, 'node_modules', manifest.name)
  await mkdir(join(root, 'node_modules'), { recursive: true })
  // Re-register now that the root exists on disk. A root registered before its
  // first install could only be recorded by its lexical path — `realpath` has
  // nothing to resolve — and a lexical prefix stops matching the moment the real
  // path differs, which would leave the redirect silently dead for the very
  // plugin just installed.
  registerDshPluginRoot(root)
  // `force` here is fs.cp's overwrite flag, unrelated to options.force:
  // reinstalling over an existing copy must replace it, not fail.
  await cp(sourceDir, destination, { recursive: true, force: true })

  const row: DshPluginRow = {
    id: options.id ?? manifest.name,
    name: manifest.name,
    version: manifest.version,
    ...(options.config ? { config: options.config } : {}),
  }
  await updatePluginRegistry(root, (current) => ({
    ...current,
    plugins: [...current.plugins.filter((existing) => existing.id !== row.id), row],
  }))
  return { row, lockstep, unmetDependencies: Object.keys(manifest.dependencies ?? {}) }
}

/**
 * Install from an npm-style tarball (`.tgz`).
 *
 * npm packs everything under a `package/` prefix, which `strip: 1` removes. The
 * tarball is expanded into a temp directory first and installed from there, so
 * a malformed archive fails before anything touches the plugin root.
 * @param root - the plugin root directory.
 * @param tarballPath - path to the `.tgz`.
 * @param options - install behaviour, including the trust grant.
 * @returns the recorded row, the lockstep report, and unmet dependencies.
 */
export async function installPluginFromTarball(
  root: string,
  tarballPath: string,
  options: InstallOptions,
): Promise<InstallResult> {
  const staging = await mkdtemp(join(tmpdir(), 'dsh-plugin-unpack-'))
  try {
    await extractTar({ file: tarballPath, cwd: staging, strip: 1 })
    return await installPluginFromDirectory(root, staging, options)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/** Where package metadata is fetched from. Overridable so tests need no network. */
export const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org'

/** Options for {@link installPluginFromNpm}. */
export interface NpmInstallOptions extends InstallOptions {
  /** Version or dist-tag; defaults to `latest`. */
  version?: string
  /** Registry base URL. */
  registry?: string
}

/**
 * Install a package from an npm registry.
 *
 * This fetches and unpacks exactly one tarball — it is not a package manager and
 * resolves no dependency tree. A plugin's dsh peers come from this build through
 * the resolver hook, which is the only reason that is enough; anything else the
 * plugin declares is reported as unmet.
 * @param root - the plugin root directory.
 * @param name - the package name.
 * @param options - install behaviour, version/registry, and the trust grant.
 * @returns the recorded row, the lockstep report, and unmet dependencies.
 * @throws when the package or version cannot be resolved or downloaded.
 */
export async function installPluginFromNpm(
  root: string,
  name: string,
  options: NpmInstallOptions,
): Promise<InstallResult> {
  const registry = (options.registry ?? DEFAULT_NPM_REGISTRY).replace(/\/$/, '')
  const wanted = options.version ?? 'latest'
  const metadataUrl = `${registry}/${name.replace('/', '%2f')}/${encodeURIComponent(wanted)}`
  const metadataResponse = await fetch(metadataUrl)
  if (!metadataResponse.ok) {
    throw new Error(`cannot resolve ${name}@${wanted}: registry answered ${metadataResponse.status}`)
  }
  const metadata = (await metadataResponse.json()) as { dist?: { tarball?: string } }
  const tarballUrl = metadata.dist?.tarball
  if (typeof tarballUrl !== 'string' || tarballUrl.length === 0) {
    throw new Error(`cannot resolve ${name}@${wanted}: metadata carries no tarball URL`)
  }

  const tarballResponse = await fetch(tarballUrl)
  if (!tarballResponse.ok) {
    throw new Error(`cannot download ${name}@${wanted}: registry answered ${tarballResponse.status}`)
  }
  const staging = await mkdtemp(join(tmpdir(), 'dsh-plugin-fetch-'))
  const tarballPath = join(staging, 'package.tgz')
  try {
    await writeFile(tarballPath, Buffer.from(await tarballResponse.arrayBuffer()))
    return await installPluginFromTarball(root, tarballPath, options)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/**
 * Remove a plugin: drop its row, then delete its package directory.
 *
 * That order matters. The row is what makes the tree mount it, so dropping the
 * row first means a reconcile racing this call finds nothing to mount rather
 * than a row whose files are already half-gone.
 * @param root - the plugin root directory.
 * @param id - the row id to remove.
 * @returns the removed row, or `null` when no such row existed.
 */
export async function uninstallPlugin(root: string, id: string): Promise<DshPluginRow | null> {
  const before = await readPluginRegistry(root)
  const row = before.plugins.find((candidate) => candidate.id === id)
  if (!row) return null
  await updatePluginRegistry(root, (current) => ({
    ...current,
    plugins: current.plugins.filter((candidate) => candidate.id !== id),
  }))
  // Another row may name the same package under a different id; only the last
  // one out takes the files.
  const after = await readPluginRegistry(root)
  if (!after.plugins.some((candidate) => candidate.name === row.name)) {
    await rm(join(root, 'node_modules', row.name), { recursive: true, force: true })
  }
  return row
}

/**
 * Turn a row on or off without uninstalling it.
 * @param root - the plugin root directory.
 * @param id - the row id.
 * @param disabled - the new state.
 * @returns whether a row with that id existed.
 */
export async function setPluginDisabled(root: string, id: string, disabled: boolean): Promise<boolean> {
  let found = false
  await updatePluginRegistry(root, (current) => ({
    ...current,
    plugins: current.plugins.map((row) => {
      if (row.id !== id) return row
      found = true
      const { disabled: _drop, ...rest } = row
      return disabled ? { ...rest, disabled: true } : rest
    }),
  }))
  return found
}
