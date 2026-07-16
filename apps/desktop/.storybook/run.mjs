/**
 * Launch Storybook with TypeScript 6 API resolution for tooling, while the
 * monorepo keeps TypeScript 7 as the default `typescript` package for tsc.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
// storybook package exports don't allow deep requires; resolve via package.json.
const storybookRoot = dirname(require.resolve('storybook/package.json'))
const dispatcher = join(storybookRoot, 'dist/bin/dispatcher.js')
const register = join(here, 'ts6-register.mjs')
const args = process.argv.slice(2)

const child = spawn(process.execPath, ['--import', register, dispatcher, ...args], {
  stdio: 'inherit',
  env: process.env,
  cwd: join(here, '..'),
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
