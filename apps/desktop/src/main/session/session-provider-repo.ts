import { z } from 'zod'
import {
  createSessionProviderStore,
  type CreateSessionProviderInput,
  type SessionProviderStore,
  type UpdateSessionProviderInput,
} from '@superone/runtime/session'
import { getDb } from '../database'
import { harnessRegistry } from './harness-registry'
import type { HarnessId, SessionProvider } from './types'

function validateConfig(harnessId: HarnessId, config: unknown): unknown {
  const harness = harnessRegistry.get(harnessId)
  if (!harness) throw new Error(`Unknown harness: ${harnessId}`)
  const schema = harness.configSchema as z.ZodSchema
  return schema.parse(config)
}

const stores = new WeakMap<object, SessionProviderStore>()

/**
 * This desktop's session_providers, checked against its harness schemas: the
 * one store its window and every node client (phones, controller desktops) write.
 */
export function sessionProviderStore(): SessionProviderStore {
  const db = getDb()
  let store = stores.get(db)
  if (!store) {
    store = createSessionProviderStore(db, { validateConfig })
    stores.set(db, store)
  }
  return store
}

export function listSessionProviders(): SessionProvider[] {
  return sessionProviderStore().list()
}

export function listByHarness(harnessId: HarnessId): SessionProvider[] {
  return sessionProviderStore().listByHarness(harnessId)
}

export function getSessionProvider(id: string): SessionProvider | null {
  return sessionProviderStore().get(id)
}

export function getBaseProvider(harnessId: HarnessId): SessionProvider {
  return sessionProviderStore().getBase(harnessId)
}

export function createSessionProvider(input: CreateSessionProviderInput): SessionProvider {
  return sessionProviderStore().create(input)
}

export function updateSessionProvider(id: string, patch: UpdateSessionProviderInput): SessionProvider {
  return sessionProviderStore().update(id, patch)
}

/** Allow config-only updates on base providers (e.g. Cursor User API Key on cursor-base). */
export function updateBaseProviderConfig(harnessId: HarnessId, config: unknown): SessionProvider {
  const existing = getBaseProvider(harnessId)
  const validated = validateConfig(harnessId, {
    ...(typeof existing.config === 'object' && existing.config ? existing.config : {}),
    ...(typeof config === 'object' && config ? config : {}),
  })
  const now = new Date().toISOString()
  getDb()
    .prepare('UPDATE session_providers SET config_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(validated), now, existing.id)
  return getSessionProvider(existing.id)!
}

export function deleteSessionProvider(id: string): boolean {
  const existing = getSessionProvider(id)
  const deleted = sessionProviderStore().delete(id)
  // A session resumes through its provider row; ones started on a deleted
  // profile resume on their harness's built-in agent instead of failing.
  if (deleted && existing) {
    getDb().prepare('UPDATE sessions SET provider_id = ? WHERE provider_id = ?').run(`${existing.harnessId}-base`, id)
  }
  return deleted
}
