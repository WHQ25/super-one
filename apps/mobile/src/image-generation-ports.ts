import type { RelayClient } from '@superone/relay-client'
import type { ListMediaProvidersResponse, MediaProviderLabel, RemoteCommand } from '@superone/shared/agent-types'
import { randomId } from './ids'

/**
 * What the image viewer's info panel needs from the host beyond the facts the
 * transcript already sent: bytes for the reference-image thumbs, and the
 * catalogue labels that turn `provider` / `model` ids into names, the way the
 * desktop viewer resolves them through `getMediaProviders`.
 */
export interface ImageGenerationPorts {
  /**
   * A reference image as a data URI, or `null` when it cannot be shown without
   * a transfer the user has not asked for (a large file over the relay). The
   * panel then shows the file name instead.
   */
  loadImage(path: string): Promise<string | null>
  /** Provider and model display names; an empty list leaves the raw ids. */
  listMediaProviders(): Promise<MediaProviderLabel[]>
}

const MEDIA_PROVIDERS_TIMEOUT_MS = 15_000

function isProviderLabel(value: unknown): value is MediaProviderLabel {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null
  return typeof record?.id === 'string' && typeof record.label === 'string' && Array.isArray(record.models)
}

/**
 * Ask the desktop for its media catalogue's labels. A host too old to know the
 * command never answers and the request times out; that surfaces as an empty
 * list and the panel keeps showing ids — the same thing an unknown id gets.
 */
export async function requestMediaProviderLabels(client: Pick<RelayClient, 'request'>): Promise<MediaProviderLabel[]> {
  const reply = await client.request({
    type: 'list_media_providers', requestId: randomId(),
  } as RemoteCommand, MEDIA_PROVIDERS_TIMEOUT_MS) as ListMediaProvidersResponse | null
  if (!reply || !('providers' in reply) || !Array.isArray(reply.providers)) return []
  return reply.providers.filter(isProviderLabel)
}
