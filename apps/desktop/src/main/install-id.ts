import { randomUUID } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

/**
 * Stable per-installation id, used only as the analytics distinct id.
 *
 * Deliberately NOT part of app-settings.json: it is not user-configurable and
 * must stay out of the settings registry / `config_apply` surface. PostHog's own
 * anonymous id lives in renderer localStorage, which resets whenever the web
 * storage is cleared — this file survives that, so DAU is not inflated.
 */
let cached: string | null = null

export function getInstallId(): string {
  if (cached) return cached
  const file = join(app.getPath('userData'), 'install-id')
  try {
    if (existsSync(file)) {
      const existing = readFileSync(file, 'utf-8').trim()
      if (existing) {
        cached = existing
        return existing
      }
    }
    const id = randomUUID()
    writeFileSync(file, id, 'utf-8')
    cached = id
    return id
  } catch {
    // Read-only / full disk: fall back to a per-run id so analytics still works
    // this session instead of failing the caller.
    cached = randomUUID()
    return cached
  }
}
