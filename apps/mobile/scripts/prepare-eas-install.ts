#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Cloud EAS sets EAS_BUILD=true. `eas build --local` sets EAS_BUILD=1.
// Either one is the build sandbox; an ordinary shell has neither.
if (process.env.EAS_BUILD !== 'true' && process.env.EAS_BUILD !== '1') {
  throw new Error('prepare-eas-install may only run inside EAS Build')
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const npmrcPath = join(repoRoot, '.npmrc')
const existingLines = existsSync(npmrcPath)
  ? readFileSync(npmrcPath, 'utf8').split(/\r?\n/)
  : []
const retainedConfig = existingLines
  .filter((line) => line.length > 0 && !/^\s*ignore-scripts\s*=/.test(line))
  .join('\n')

writeFileSync(npmrcPath, `${retainedConfig}${retainedConfig ? '\n' : ''}ignore-scripts=true\n`)
console.log('Configured EAS dependency installation to skip unrelated workspace lifecycle scripts')
