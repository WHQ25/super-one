import { useActivityPanelStore } from '@/stores/activity-panel'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { useWindowMiniModeStore, selectPanelsFolded } from '@/stores/window-mini-mode'

/**
 * Whether the Activity panel is actually on screen. The single predicate — every
 * consumer reads this rather than re-deriving it, because the ways the panel can
 * be off screen do not all funnel through `showPanel`.
 *
 * The panel hides by collapsing its *outer* wrapper to `width: 0; overflow: hidden`
 * while the inner dockview keeps its full `panelWidth` layout box, so nothing inside
 * reflows during the animation. Clipping does not change `getBoundingClientRect`, so
 * a slot measured in there stays live and non-zero even when nothing of it is
 * painted. Any host layer that positions a native `<webview>` from such a slot has to
 * consult this, or it paints the guest over whatever took the panel's place.
 *
 * Mosaic also forces `showPanel` to false on entry, so it was covered by accident.
 * The mini-window fold deliberately does not — it must not clobber the user's own
 * panel toggle — which is why the hidden state has to be readable on its own.
 */
export function useActivityPanelOnScreen(): boolean {
  const showPanel = useActivityPanelStore((s) => s.showPanel)
  const mosaic = useMosaicStore((s) => s.mode === 'mosaic')
  const folded = useWindowMiniModeStore(selectPanelsFolded)
  return showPanel && !mosaic && !folded
}
