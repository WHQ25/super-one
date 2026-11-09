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
const child = Bun.spawn(
  ['electron-vite', 'dev', ...viteArgs, ...(devtools ? ['--', '--devtools'] : [])],
  { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' },
)
process.exit(await child.exited)
