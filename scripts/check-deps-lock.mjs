#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const lockPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bun.lock')
const lock = readFileSync(lockPath, 'utf8')

const banned = [
  {
    pattern: /"vite@(8|9|[1-9]\d)\./,
    name: 'vite >= 8',
    reason:
      'vite 8 ships rolldown (RC) as its bundler. It produced broken chunk ordering ' +
      '(createLucideIcon TDZ) and was pinned to ~7.3 via root package.json overrides. ' +
      'Remove the override AND this guard intentionally if you want to upgrade.',
  },
  {
    pattern: /"rolldown@/,
    name: 'rolldown',
    reason:
      'Rolldown is still RC (1.0 GA not released). It is the root cause of the chunk ' +
      'ordering bug shipped in 0.38.0-alpha. Stay on Rollup 4 (vite 7) until rolldown 1.0 ' +
      'has at least 6 months of burn-in.',
  },
]

const hits = banned.filter(({ pattern }) => pattern.test(lock))

if (hits.length === 0) {
  console.log('check-deps-lock: OK')
  process.exit(0)
}

for (const hit of hits) {
  const isCi = !!process.env.GITHUB_ACTIONS
  const prefix = isCi ? '::error::' : 'ERROR: '
  console.error(`${prefix}Banned dependency detected: ${hit.name}`)
  console.error(`${prefix}${hit.reason}`)
}
process.exit(1)
