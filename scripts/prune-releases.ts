/**
 * Decide which archived versions of one variant may be deleted from R2.
 *
 * Split from the workflow the same way set-latest is: this computes a plan,
 * the workflow executes it. The rule that matters is the guard -- a version
 * still referenced by a channel pointer must never be removed, because the
 * pointer yml keeps handing that exact `v<version>/` path to every client on
 * the variant, and deleting it turns every download and every update into a
 * 404 with no error anywhere in CI.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { compareVersions } from './lib/channels'

export type PruneMode = 'single' | 'older-than'

export interface PrunePlanOptions {
  mode: PruneMode
  /** Target version (single), or the exclusive boundary (older-than). */
  version: string
  /** Versions currently archived under the variant prefix. */
  present: string[]
  /** Versions the variant's latest-*.yml files point at. */
  liveVersions: string[]
}

export interface PrunePlan {
  remove: string[]
  keep: { version: string; reason: string }[]
  /** Asked for but not archived — surfaced rather than silently ignored. */
  missing: string[]
}

function normalise(version: string): string {
  return version.trim().replace(/^v/i, '')
}

export function planPrune(options: PrunePlanOptions): PrunePlan {
  const target = normalise(options.version)
  const present = options.present.map(normalise).filter(Boolean)
  const live = new Set(options.liveVersions.map(normalise).filter(Boolean))

  const remove: string[] = []
  const keep: { version: string; reason: string }[] = []

  for (const version of present) {
    if (live.has(version)) {
      keep.push({ version, reason: 'published as the current latest' })
      continue
    }
    const selected =
      options.mode === 'single'
        ? version === target
        : compareVersions(version, target) < 0
    if (!selected) {
      keep.push({
        version,
        reason: options.mode === 'single' ? 'not the requested version' : `not older than ${target}`,
      })
      continue
    }
    remove.push(version)
  }

  const missing =
    options.mode === 'single' && !present.includes(target) ? [target] : []

  remove.sort(compareVersions)
  keep.sort((a, b) => compareVersions(a.version, b.version))
  return { remove, keep, missing }
}

/** `alpha/v0.61.0-alpha/SuperOne.dmg` -> `0.61.0-alpha`, for one variant. */
export function versionsFromKeys(keys: string[], variant: string): string[] {
  const prefix = `${variant}/v`
  const found = new Set<string>()
  for (const raw of keys) {
    const key = raw.trim()
    if (!key.startsWith(prefix)) continue
    const rest = key.slice(prefix.length)
    const version = rest.split('/')[0]
    if (version) found.add(version)
  }
  return [...found]
}

function main(): void {
  const [mode, version, variant, keysFile, liveArg, planPath] = process.argv.slice(2)
  if (mode !== 'single' && mode !== 'older-than') {
    console.error('usage: prune-releases <single|older-than> <version> <variant> <keysFile> <liveCsv> [planPath]')
    process.exit(1)
  }
  const keys = readFileSync(keysFile, 'utf8').split('\n')
  const plan = planPrune({
    mode,
    version,
    present: versionsFromKeys(keys, variant),
    liveVersions: (liveArg ?? '').split(',').filter(Boolean),
  })

  for (const { version: v, reason } of plan.keep) console.log(`keep   ${v}  (${reason})`)
  for (const v of plan.remove) console.log(`REMOVE ${variant}/v${v}/`)
  for (const v of plan.missing) console.log(`::warning::${variant}/v${v}/ is not archived — nothing to remove`)
  console.log(`\n${plan.remove.length} version(s) to remove, ${plan.keep.length} kept`)

  writeFileSync(planPath ?? 'prune-plan.json', JSON.stringify(plan, null, 2))
}

if (process.argv[1]?.endsWith('prune-releases.ts')) main()
