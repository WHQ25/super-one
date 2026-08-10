/**
 * Whether the app may resolve Claude/Codex from local node_modules platform
 * packages (optional deps / electron-vite dev).
 *
 * Packaged builds (P5+) never ship those binaries — only managed installs under
 * ~/.superone/harness (or SUPERONE_*_BINARY env / PATH for codex) are valid.
 */

import { app } from 'electron'

export function allowBundledHarnessPlatformPackages(): boolean {
  try {
    return !app.isPackaged
  } catch {
    // Tests / non-Electron import paths: keep local optional deps usable.
    return true
  }
}
