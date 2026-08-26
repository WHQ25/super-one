import type { CapabilityTask } from '@superone/shared/agent-types'
import { type ConsumerId, type EndpointModel, type ResolvedService } from '@superone/shared/platform-registry'
import { listCredentials } from '../providers/credential-store'
import { listServiceModels, resolveService } from '../providers/resolver'
import type { MediaProviderConfig, MediaProviderKind } from './types'

function officialOpenAI(resolved: ResolvedService): boolean {
  return resolved.platformId === 'openai' || resolved.platformId === 'openai-official'
}

/**
 * Adapter selection for image protocols. The strict-vs-compatible OpenAI split is decided by
 * platform id (official `openai` → strict `createOpenAI`), not by protocol (plan §2.1).
 */
export function mediaKindFor(resolved: ResolvedService): MediaProviderKind {
  switch (resolved.protocol) {
    case 'google-generative':
      return 'google'
    case 'ark-images':
      return 'ark'
    case 'openai-images':
    case 'openai-responses':
      return officialOpenAI(resolved) ? 'openai' : 'openai-compatible'
    default:
      throw new Error(`protocol '${resolved.protocol}' does not serve image generation`)
  }
}

/** Adapter selection for video protocols — same official-vs-relay split as images. */
export function videoKindFor(resolved: ResolvedService): MediaProviderKind {
  switch (resolved.protocol) {
    case 'google-video':
      return 'google'
    case 'ark-video':
      return 'ark'
    case 'openai-video':
      return officialOpenAI(resolved) ? 'openai' : 'openai-compatible'
    case 'newapi-video':
      return 'newapi'
    default:
      throw new Error(`protocol '${resolved.protocol}' does not serve video generation`)
  }
}

/**
 * Effective enabled models for a resolved service, narrowed to those that actually serve the task.
 * A single endpoint (e.g. Gemini generateContent) may serve chat/image/tts at once, so the shared
 * enabled list is filtered by each model's tagged tasks. Enabling is opt-in: an empty result means
 * no model is available until the user enables one in Settings → Providers.
 */
export function modelsForTask(resolved: ResolvedService, task: CapabilityTask): EndpointModel[] {
  return resolved.models.filter((m) => !m.tasks || m.tasks.includes(task))
}

export function imageModelsFor(resolved: ResolvedService): EndpointModel[] {
  return modelsForTask(resolved, 'image')
}

export function videoModelsFor(resolved: ResolvedService): EndpointModel[] {
  return modelsForTask(resolved, 'video')
}

/** One media capability's resolution rules. Image and video differ only in these four values. */
interface MediaConsumerSpec {
  consumer: ConsumerId
  task: CapabilityTask
  kindFor: (resolved: ResolvedService) => MediaProviderKind
  label: string
}

const IMAGE: MediaConsumerSpec = { consumer: 'media:image', task: 'image', kindFor: mediaKindFor, label: 'image' }
const VIDEO: MediaConsumerSpec = { consumer: 'media:video', task: 'video', kindFor: videoKindFor, label: 'video' }

function toConfig(resolved: ResolvedService, spec: MediaConsumerSpec): MediaProviderConfig {
  return {
    id: resolved.credentialId,
    kind: spec.kindFor(resolved),
    apiKey: resolved.apiKey,
    baseURL: resolved.baseUrl || undefined,
    models: modelsForTask(resolved, spec.task).map((m) => m.id),
  }
}

function resolveProvider(
  spec: MediaConsumerSpec,
  credentialId?: string | null,
  modelId?: string | null,
): MediaProviderConfig {
  const resolved = resolveService(spec.consumer, { credentialId, modelId: modelId ?? undefined })
  if (!resolved) {
    throw new Error(`No ${spec.label} provider is configured. Ask the user to add one in Settings → Providers.`)
  }
  if (!resolved.apiKey) {
    throw new Error(`No API key configured for ${spec.label} provider '${resolved.credentialId}'`)
  }
  return toConfig(resolved, spec)
}

/**
 * The default model for a capability: the first enabled model across every endpoint that serves it,
 * not just the endpoint that happens to resolve — with video wires split one endpoint per wire, the
 * resolved endpoint is only one of several the key can reach.
 */
function resolveDefaultModelFor(spec: MediaConsumerSpec, credentialId?: string | null): string {
  const resolved = resolveService(spec.consumer, { credentialId })
  const first = resolved ? listServiceModels(spec.consumer, resolved.credentialId)[0]?.id : undefined
  if (!first) throw new Error(`No default model available for the ${spec.label} provider`)
  return first
}

/** Pick a credential that resolves with a usable key — the bound one first, else any. */
function resolveDefaultProviderIdFor(spec: MediaConsumerSpec): string {
  const bound = resolveService(spec.consumer)
  if (bound?.apiKey) return bound.credentialId
  for (const cred of listCredentials()) {
    const resolved = resolveService(spec.consumer, { credentialId: cred.id })
    if (resolved?.apiKey) return resolved.credentialId
  }
  throw new Error(`No ${spec.label} provider is configured. Ask the user to add one in Settings → Providers.`)
}

/** Resolve an image provider from a credential id (or the global `media:image` binding when omitted). */
export async function resolveMediaProvider(credentialId?: string | null): Promise<MediaProviderConfig> {
  return resolveProvider(IMAGE, credentialId)
}

export async function resolveDefaultModel(credentialId?: string | null): Promise<string> {
  return resolveDefaultModelFor(IMAGE, credentialId)
}

export async function resolveDefaultProviderId(): Promise<string> {
  return resolveDefaultProviderIdFor(IMAGE)
}

/**
 * Resolve a video provider from a credential id (or the global `media:video` binding when omitted).
 *
 * `modelId` is what separates the video wires a single credential may expose: Seedance on Ark's own
 * endpoint and Sora on `/videos` live under one key, and only the model says which to submit to.
 * Omitting it falls back to the credential's first video-serving endpoint.
 */
export async function resolveVideoProvider(
  credentialId?: string | null,
  modelId?: string | null,
): Promise<MediaProviderConfig> {
  return resolveProvider(VIDEO, credentialId, modelId)
}

export async function resolveDefaultVideoModel(credentialId?: string | null): Promise<string> {
  return resolveDefaultModelFor(VIDEO, credentialId)
}

export async function resolveDefaultVideoProviderId(): Promise<string> {
  return resolveDefaultProviderIdFor(VIDEO)
}
