import { watchScrollEdgeFades } from '@superone/ui/lib/scroll-edge-fade'

/**
 * Activity tab strips use the shared scroll-edge fade repair.
 * The implementation lives in `@superone/ui` so chat tables can use it too.
 */
export { releaseFinishedScrollEdgeFade, watchScrollEdgeFade as watchTabStripEdgeFade } from '@superone/ui/lib/scroll-edge-fade'

/** Finds every tab strip under `root` and drops strips that have left the document. */
export function watchTabStrips(root: ParentNode): { scan: () => void; stop: () => void } {
  return watchScrollEdgeFades(root, '.dv-tabs-container')
}
