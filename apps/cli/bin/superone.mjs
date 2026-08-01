#!/usr/bin/env node
/**
 * `superone` bin entry for workspace / future npm installs.
 *
 * Prefer a prebuilt bundle when present (npm pack / dist); otherwise load the
 * TypeScript entry via `tsx` so monorepo `bun --filter @superone/cli` still works.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const bundled = join(root, 'dist', 'npm', 'cli.mjs')

if (existsSync(bundled)) {
  await import(pathToFileURL(bundled).href)
  process.exit(0)
}

const entry = join(root, 'src', 'cli.ts')
const require = createRequire(import.meta.url)
let tsxLoader
try {
  tsxLoader = require.resolve('tsx/esm')
} catch {
  console.error(
    'superone: no bundled CLI and tsx is not installed. Run from the monorepo or install @super-one/cli from npm.',
  )
  process.exit(1)
}

const result = spawnSync(
  process.execPath,
  ['--import', tsxLoader, entry, ...process.argv.slice(2)],
  { stdio: 'inherit', env: process.env },
)
process.exit(result.status === null ? 1 : result.status)
