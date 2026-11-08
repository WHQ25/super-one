import type { CapabilityTask, ConsumerId } from '@superone/shared/platform-registry'
import { type EndpointModel, type ResolvedService } from '@superone/shared/platform-registry'
import { getBinding, listCredentials } from '../providers/credential-store'
import { listServiceModels, resolveService } from '../providers/resolver'
import { defaultVoice, speechKindFor, type SpeechProviderKind } from './kinds'

export interface SpeechProviderConfig {
  id: string
  kind: SpeechProviderKind
  apiKey: string
  baseURL?: string
  models: string[]
  platformId: string
  label: string
}

interface SpeechConsumerSpec {
  consumer: ConsumerId
  task: CapabilityTask
  label: string
}

const TTS: SpeechConsumerSpec = { consumer: 'tts', task: 'tts', label: 'speech' }
const ASR: SpeechConsumerSpec = { consumer: 'asr', task: 'asr', label: 'transcription' }

export function speechSpec(task: 'tts' | 'asr'): SpeechConsumerSpec {
  return task === 'tts' ? TTS : ASR
}

function toConfig(resolved: ResolvedService, spec: SpeechConsumerSpec): SpeechProviderConfig {
  return {
    id: resolved.credentialId,
    kind: speechKindFor(resolved),
    apiKey: resolved.apiKey,
    baseURL: resolved.baseUrl || undefined,
    models: resolved.models.filter((m) => !m.tasks || m.tasks.includes(spec.task)).map((m) => m.id),
    platformId: resolved.platformId,
    label: resolved.platformId,
  }
}

function resolveProvider(spec: SpeechConsumerSpec, credentialId?: string | null, modelId?: string | null): SpeechProviderConfig {
  const resolved = resolveService(spec.consumer, { credentialId, modelId: modelId ?? undefined })
  if (!resolved) {
    throw new Error(`No ${spec.label} provider is configured. Add a key and enable a model in Settings → Providers.`)
  }
  if (!resolved.apiKey) {
    throw new Error(`No API key configured for ${spec.label} provider '${resolved.credentialId}'`)
  }
  return toConfig(resolved, spec)
}

export function resolveSpeechProvider(credentialId?: string | null, modelId?: string | null): SpeechProviderConfig {
  return resolveProvider(TTS, credentialId, modelId)
}

export function resolveTranscriptionProvider(credentialId?: string | null, modelId?: string | null): SpeechProviderConfig {
  return resolveProvider(ASR, credentialId, modelId)
}

function firstModel(spec: SpeechConsumerSpec, credentialId?: string | null): string {
  const resolved = resolveService(spec.consumer, { credentialId })
  const first = resolved ? listServiceModels(spec.consumer, resolved.credentialId)[0]?.id : undefined
  if (!first) throw new Error(`No default model available for the ${spec.label} provider`)
  return first
}

export function resolveDefaultSpeechModel(credentialId?: string | null): string {
  const resolved = resolveService(TTS.consumer, { credentialId })
  if (!resolved?.apiKey) {
    throw new Error(`No ${TTS.label} provider is configured. Add a key and enable a model in Settings → Providers.`)
  }
  const models = listServiceModels(TTS.consumer, resolved.credentialId)
  const binding = getBinding('tts')
  const saved = binding?.credentialId === resolved.credentialId ? binding.config?.modelId : undefined
  const modelId = saved && models.some((model) => model.id === saved) ? saved : models[0]?.id
  if (!modelId) throw new Error(`No default model available for the ${TTS.label} provider`)
  return modelId
}

export function resolveDefaultTranscriptionModel(credentialId?: string | null): string {
  return firstModel(ASR, credentialId)
}

function firstProviderId(spec: SpeechConsumerSpec): string {
  const bound = resolveService(spec.consumer)
  if (bound?.apiKey) return bound.credentialId
  for (const cred of listCredentials()) {
    const resolved = resolveService(spec.consumer, { credentialId: cred.id })
    if (resolved?.apiKey) return resolved.credentialId
  }
  throw new Error(`No ${spec.label} provider is configured. Add a key and enable a model in Settings → Providers.`)
}

export function resolveDefaultSpeechProviderId(): string {
  return firstProviderId(TTS)
}

export function resolveDefaultTranscriptionProviderId(): string {
  return firstProviderId(ASR)
}

export interface SpeechProviderListing {
  id: string
  label: string
  platformId: string
  kind: SpeechProviderKind
  task: 'tts' | 'asr'
  /** Saved speech model for this account, otherwise the first enabled model. */
  defaultModel: string
  defaultVoice: string
  models: EndpointModel[]
}

/** Credentials that can actually serve the task: a key plus at least one enabled model. */
export function listSpeechProviders(task?: 'tts' | 'asr'): SpeechProviderListing[] {
  const tasks = task ? [task] : (['tts', 'asr'] as const)
  const seen = new Set<string>()
  const listings: SpeechProviderListing[] = []
  const speechBinding = getBinding('tts')
  for (const cred of listCredentials()) {
    for (const current of tasks) {
      const spec = speechSpec(current)
      const resolved = resolveService(spec.consumer, { credentialId: cred.id })
      if (!resolved?.apiKey) continue
      const models = resolved.models.filter((m) => !m.tasks || m.tasks.includes(spec.task))
      if (models.length === 0) continue
      const key = `${cred.id}:${current}`
      if (seen.has(key)) continue
      seen.add(key)
      const kind = speechKindFor(resolved)
      listings.push({
        id: resolved.credentialId,
        label: cred.name,
        platformId: resolved.platformId,
        kind,
        task: current,
        defaultModel: current === 'tts'
          && speechBinding?.credentialId === cred.id
          && speechBinding.config?.modelId
          && models.some((model) => model.id === speechBinding.config?.modelId)
          ? speechBinding.config.modelId
          : models[0]!.id,
        defaultVoice: defaultVoice(kind),
        models,
      })
    }
  }
  return listings
}
