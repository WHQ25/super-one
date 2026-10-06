import { supportsShortWidgetResult } from '@superone/shared/harness/harness-capabilities'
import { currentCallOwner } from '../mcp/artifact-registry'

/**
 * Whether a `widget_show` call gets the short acknowledgement: only this desktop's own
 * session, and only on a harness whose transcript keeps the call's complete input. A remote
 * session's Host Action gets the full reply and its node shortens it; a call outside any
 * scope is never assumed to be local. Both are read when the call runs.
 */
export function shortensWidgetResult(harnessOf: () => string | undefined): () => boolean {
  return () => currentCallOwner() === null && supportsShortWidgetResult(harnessOf())
}
