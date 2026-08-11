/**
 * Lightweight writer for app/harness-pins/<version>.json (no tarball pack).
 *
 * Prefer the full pipeline when releasing:
 *   bun run publish:harness -- --channel alpha --upload
 * which stages + uploads artifacts, channel manifest, *and* app pins together.
 *
 * Use this only when you need the pins file without re-packing multi-hundred-MB
 * tarballs (e.g. pins-only republish after a version bump with same pins).
 *
 *   bun scripts/write-app-harness-pins.ts --version 0.12.0-alpha.3
 *   bun scripts/write-app-harness-pins.ts --version 0.12.0-alpha.3 --out staging
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  appHarnessPinsObjectKey,
  currentProcessAppHarnessPins,
} from '../packages/runtime/src/harness/app-harness-pins.ts'

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  if (i < 0) return null
  return process.argv[i + 1] ?? null
}

const version = argValue('--version')?.trim()
if (!version) {
  console.error('usage: bun scripts/write-app-harness-pins.ts --version <appVersion> [--out dir]')
  process.exit(1)
}

const outRoot = argValue('--out')?.trim() || 'staging'
const pins = currentProcessAppHarnessPins(version)
const rel = appHarnessPinsObjectKey(version)
const outPath = join(outRoot, rel)
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, `${JSON.stringify(pins, null, 2)}\n`)
console.log(`wrote ${outPath}`)
console.log(JSON.stringify(pins, null, 2))
