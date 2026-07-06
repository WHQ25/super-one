import { randomUUID } from 'crypto'
import { existsSync, mkdirSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { mediaGenRoot } from './paths'
import type { MediaProviderKind } from './types'

export type CustomMediaProviderKind = Extract<MediaProviderKind, 'openai-compatible' | 'google'>

export interface CustomMediaProvider {
  id: string
  label: string
  kind: CustomMediaProviderKind
  baseURL: string
  models: string[]
}

export interface UpsertCustomProviderInput {
  id?: string
  label: string
  baseURL: string
  models: string[]
  kind?: CustomMediaProviderKind
}

function providersPath(): string {
  return join(mediaGenRoot(), 'providers.json')
}

export async function readCustomProviders(): Promise<CustomMediaProvider[]> {
  const path = providersPath()
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as CustomMediaProvider[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeCustomProviders(providers: CustomMediaProvider[]): Promise<void> {
  mkdirSync(mediaGenRoot(), { recursive: true })
  await writeFile(providersPath(), JSON.stringify(providers, null, 2))
}

export async function getCustomProvider(id: string): Promise<CustomMediaProvider | undefined> {
  return (await readCustomProviders()).find((provider) => provider.id === id)
}

export async function upsertCustomProvider(input: UpsertCustomProviderInput): Promise<CustomMediaProvider> {
  const providers = await readCustomProviders()
  const id = input.id ?? `custom-${randomUUID().slice(0, 8)}`
  const entry: CustomMediaProvider = {
    id,
    label: input.label.trim() || id,
    kind: input.kind ?? 'openai-compatible',
    baseURL: input.baseURL.trim(),
    models: input.models.map((model) => model.trim()).filter(Boolean),
  }
  const index = providers.findIndex((provider) => provider.id === id)
  if (index >= 0) providers[index] = entry
  else providers.push(entry)
  await writeCustomProviders(providers)
  return entry
}

export async function removeCustomProvider(id: string): Promise<void> {
  const providers = await readCustomProviders()
  await writeCustomProviders(providers.filter((provider) => provider.id !== id))
}
