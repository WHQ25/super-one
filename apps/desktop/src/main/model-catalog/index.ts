import { app } from 'electron'
import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { Models } from '@opencode-ai/models'
import type { Model as SdkModel, ProviderMap } from '@opencode-ai/models'
import type {
  CatalogModel,
  CatalogModality,
  CatalogProvider,
  ModelCatalog,
  ModelCatalogSource,
} from '@superone/shared/model-catalog-types'
import log from '../logger'

const CACHE_VERSION = 1

interface CacheBlob {
  version: number
  generatedAt: string
  providers: ProviderMap
}

function cachePath(): string {
  return join(app.getPath('userData'), 'model-catalog.json')
}

function projectModel(providerId: string, m: SdkModel): CatalogModel {
  return {
    id: m.id,
    name: m.name,
    providerId,
    contextWindow: m.limit?.context,
    maxOutput: m.limit?.output,
    cost: m.cost
      ? {
          input: m.cost.input,
          output: m.cost.output,
          cacheRead: m.cost.cache_read,
          cacheWrite: m.cost.cache_write,
          reasoning: m.cost.reasoning,
        }
      : undefined,
    inputModalities: (m.modalities?.input ?? []) as CatalogModality[],
    outputModalities: (m.modalities?.output ?? []) as CatalogModality[],
    reasoning: !!m.reasoning,
    toolCall: !!m.tool_call,
    attachment: !!m.attachment,
    releaseDate: m.release_date,
    knowledge: m.knowledge,
    status: m.status,
  }
}

function projectProviders(map: ProviderMap): CatalogProvider[] {
  return Object.values(map).map((p) => ({
    id: p.id,
    name: p.name,
    npm: p.npm,
    api: p.api,
    env: p.env ?? [],
    doc: p.doc,
    models: Object.values(p.models).map((m) => projectModel(p.id, m)),
  }))
}

async function readCache(): Promise<CacheBlob | null> {
  const path = cachePath()
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as CacheBlob
    if (parsed.version !== CACHE_VERSION || typeof parsed.providers !== 'object' || parsed.providers == null) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

async function writeCache(providers: ProviderMap, generatedAt: string): Promise<void> {
  const path = cachePath()
  await mkdir(dirname(path), { recursive: true })
  const blob: CacheBlob = { version: CACHE_VERSION, generatedAt, providers }
  await writeFile(path, JSON.stringify(blob))
}

let memo: ModelCatalog | null = null
let refreshing = false

function toCatalog(map: ProviderMap, generatedAt: string, source: ModelCatalogSource): ModelCatalog {
  return { providers: projectProviders(map), generatedAt, source }
}

async function fetchAndCache(): Promise<ModelCatalog> {
  const providers = await Models.make().providers()
  const generatedAt = new Date().toISOString()
  await writeCache(providers, generatedAt).catch((err) => log.warn('[model-catalog] cache write failed:', err))
  memo = toCatalog(providers, generatedAt, 'network')
  return memo
}

function refreshInBackground(): void {
  if (refreshing) return
  refreshing = true
  void fetchAndCache()
    .catch((err) => log.warn('[model-catalog] background refresh failed:', err))
    .finally(() => {
      refreshing = false
    })
}

export async function getModelCatalog(): Promise<ModelCatalog> {
  if (memo) {
    refreshInBackground()
    return memo
  }

  const cached = await readCache()
  if (cached) {
    memo = toCatalog(cached.providers, cached.generatedAt, 'cache')
    refreshInBackground()
    return memo
  }

  const snapshot = await import('@opencode-ai/models/snapshot')
  memo = toCatalog(snapshot.providers, snapshot.generatedAt, 'snapshot')
  refreshInBackground()
  return memo
}

export async function refreshModelCatalog(): Promise<ModelCatalog> {
  return fetchAndCache()
}
