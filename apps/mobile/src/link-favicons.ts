import type { RelayClient } from '@superone/relay-client'
import type { RemoteCommand } from '@superone/shared/agent-types'
import { randomId } from './ids'

/**
 * Resolving one favicon can cost the desktop an HTML fetch (8 s budget) plus
 * the icon download before its cache is warm, so this waits longer than the
 * client's default.
 */
const FAVICON_TIMEOUT_MS = 20_000

/**
 * Ask the desktop for the favicon its own chat shows in front of `url`. A
 * host too old to know the command never answers and the request times out;
 * that surfaces as null and the link keeps its globe.
 */
export async function requestLinkFavicon(
  client: Pick<RelayClient, 'request'>,
  url: string,
  isDark: boolean,
): Promise<string | null> {
  const reply = await client.request({
    type: 'resolve_favicon', requestId: randomId(), url, isDark,
  } as RemoteCommand, FAVICON_TIMEOUT_MS) as { dataUrl?: unknown } | null
  const dataUrl = reply?.dataUrl
  return typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') ? dataUrl : null
}
