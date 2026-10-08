import { join } from 'node:path'

/**
 * A dev-run file in the electron-vite cwd (`dev.log`, event traces). A named
 * instance (`SUPERONE_INSTANCE`: a second dev app, an e2e run) gets its own,
 * so it never writes into the developer's files.
 */
export function devRunFile(stem: string, ext: string): string {
  const instance = process.env.SUPERONE_INSTANCE?.trim()
  return join(process.cwd(), instance ? `instance-${instance}-${stem}${ext}` : `${stem}${ext}`)
}
