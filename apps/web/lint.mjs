/**
 * `eslint`, launched with the TypeScript 6 redirect in ts6-register.mjs.
 * Spawning rather than setting NODE_OPTIONS in the script keeps this working on
 * Windows, where inline `VAR='...' cmd` is not shell-portable.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const eslintBin = join(dirname(require.resolve('eslint/package.json')), 'bin', 'eslint.js')
const register = pathToFileURL(join(here, 'ts6-register.mjs')).href

const child = spawn(process.execPath, ['--import', register, eslintBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: here,
})
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)))
