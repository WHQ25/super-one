import { z } from 'zod'
import {
  createSessionProviderStore,
  type AgentProfileWriter,
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

type DesktopSessionProviderStore = SessionProviderStore & { profiles: AgentProfileWriter }

const stores = new WeakMap<object, DesktopSessionProviderStore>()

/**
 * This desktop's session_providers, checked against its harness schemas: the
 * one store its window and every node client (phones, controller desktops) write.
 * Agent profile rows change only through `agent-profile-store.ts`.
 */
export function sessionProviderStore(): DesktopSessionProviderStore {
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
  // Built-in agents are never profiles; profiles are separate, user-confirmed rows.
  if (config && typeof config === 'object' && (config as { profile?: unknown }).profile !== undefined) {
    throw new Error(`Base provider ${harnessId}-base cannot carry an agent profile`)
  }
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

/**
 * Delete a provider row and, in the same transaction, move the sessions
 * started on it to their harness's built-in row: a session resumes through its
 * provider row, so a dangling id would fail every later resume.
 */
export function deleteProviderRow(existing: SessionProvider, remove: () => boolean): boolean {
  return getDb().transaction(() => {
    const deleted = remove()
    if (deleted) {
      getDb().prepare('UPDATE sessions SET provider_id = ? WHERE provider_id = ?').run(`${existing.harnessId}-base`, existing.id)
    }
    return deleted
  })()
}

export function deleteSessionProvider(id: string): boolean {
  const existing = getSessionProvider(id)
  if (!existing) return false
  return deleteProviderRow(existing, () => sessionProviderStore().delete(id))
}

/** The store as node clients write it: profile rows refused, a delete moves the row's sessions too. */
export function clientSessionProviderStore(): SessionProviderStore {
  const store = sessionProviderStore()
  return {
    list: store.list,
    listByHarness: store.listByHarness,
    get: store.get,
    getBase: store.getBase,
    create: store.create,
    update: store.update,
    delete: deleteSessionProvider,
  }
}
