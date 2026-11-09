/**
 * Electron 42+ does not download its binary from its own postinstall.
 * electron-vite only reads path.txt and exits with "Electron uninstall"
 * until install.js has run. Always target this machine: a cross-os
 * `bun install --os --cpu` (prepare:*-optional-deps) must not replace
 * the host binary.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

let installJs
try {
  installJs = path.join(path.dirname(require.resolve('electron/package.json')), 'install.js')
} catch {
  console.error('electron is not installed; run bun install from the repo root')
  process.exit(1)
}

const result = spawnSync(process.execPath, [installJs], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_INSTALL_PLATFORM: process.platform,
    ELECTRON_INSTALL_ARCH: process.arch,
  },
})

if (result.error) {
  console.error(result.error)
  process.exit(1)
}
process.exit(result.status ?? 1)
