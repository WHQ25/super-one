/**
 * Node session_providers CRUD RPC contracts.
 *
 * Electron-free. Aligns with desktop session-provider-repo wire shapes so
 * collaboration.listProfiles and multi-profile remote model selectors can
 * share the same profile ids (claude-base, custom profiles, …).
 */

import type { HarnessId } from '../session-types'

/** Wire shape returned by sessionProviders.list|get|create|update|getBase. */
export interface NodeSessionProvider {
  id: string
  harnessId: HarnessId
  name: string
  isBase: boolean
  config: unknown
  createdAt: number
  updatedAt: number
}

export interface SessionProvidersListRequest {
  /** Optional filter by harness. */
  harnessId?: HarnessId | string
}

export interface SessionProvidersListResult {
  providers: NodeSessionProvider[]
}

export interface SessionProvidersGetRequest {
  id: string
}

export interface SessionProvidersGetResult {
  provider: NodeSessionProvider | null
}

export interface SessionProvidersGetBaseRequest {
  harnessId: HarnessId | string
}

export interface SessionProvidersGetBaseResult {
  provider: NodeSessionProvider
}

export interface SessionProvidersCreateRequest {
  harnessId: HarnessId | string
  name: string
  config?: unknown
  id?: string
}

export interface SessionProvidersCreateResult {
  provider: NodeSessionProvider
}

export interface SessionProvidersUpdateRequest {
  id: string
  name?: string
  config?: unknown
}

export interface SessionProvidersUpdateResult {
  provider: NodeSessionProvider
}

export interface SessionProvidersDeleteRequest {
  id: string
}

export interface SessionProvidersDeleteResult {
  ok: true
}
