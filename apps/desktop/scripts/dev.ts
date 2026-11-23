import { join } from 'node:path'
import { linkDevChromeExtension } from '../src/main/browser/chrome-extension-install.ts'

// Dev may start from a worktree. Retarget the unpacked extension at this checkout.
const extensionDir = linkDevChromeExtension(join(import.meta.dir, '..'))
console.log(`Chrome Dev extension linked at ${extensionDir}`)

// electron-vite does not trigger Electron's lazy binary download.
const ensure = Bun.spawnSync(['node', 'scripts/ensure-electron.mjs'], {
  stdout: 'inherit',
  stderr: 'inherit',
})
if (ensure.exitCode !== 0) process.exit(ensure.exitCode ?? 1)

// Keep application flags behind electron-vite's argument separator.
const args = process.argv.slice(2)
const devtools = args.includes('--devtools')
const viteArgs = args.filter((arg) => arg !== '--devtools' && arg !== '--')
const env = { ...process.env }
delete env.SUPERONE_HOME
delete env.SUPERONE_VARIANT
const child = Bun.spawn(
  ['electron-vite', 'dev', ...viteArgs, ...(devtools ? ['--', '--devtools'] : [])],
  { env, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' },
)
process.exit(await child.exited)
