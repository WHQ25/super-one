import { useShallow } from 'zustand/react/shallow'
import { useActivityPanelStore } from '@/stores/activity-panel'
import {
  selectHostedDeviceSessions,
  useDevicePipStore,
  type DeviceSlot,
} from '@/stores/device-pip'
import { useSashResizing } from '@/hooks/useSashResizing'
import { useGlobalDragging } from '@/hooks/useGlobalDragging'
import { DevicePanel } from './DevicePanel'
import { DeviceOverlaySurface } from './DeviceOverlaySurface'
import { DevicePictureInPicture } from './DevicePictureInPicture'
import { useDeviceHandover } from './use-device-handover'

/**
 * A plausible phone-shaped box for a panel with no slot at all — in Settings, or in
 * the beat between two surfaces. Only ever laid out off-screen, so the numbers are
 * about keeping the device's own layout from collapsing to zero and thrashing on the
 * way back, not about anything the user sees.
 */
const FALLBACK_SLOT = { width: 390, height: 844 }

/** How far off-screen a parked panel goes. Mirrors `BrowserHostLayer`. */
const PARKED_LEFT = -99999

/**
 * The one place a simulator is ever mounted.
 *
 * Exactly one `DevicePanel` per session with a device, mounted here for as long
 * as the device exists, and moved by absolute position onto whichever surface is
 * showing it. The Activity tab and the floating preview only report a rect (see
 * `DeviceView`), so switching between them repositions a running panel instead
 * of destroying one and booting another — which is what a switch used to cost, and
 * why it flashed black: the arriving panel had to re-read the device list and rebind
 * before it had a picture, and the helper encodes with a one-second keyframe
 * interval, so its fresh decoder then sat dark waiting for an I-frame.
 *
 * Rendered in EVERY `App.tsx` view branch, at the same child index, next to the
 * browser's and the mini-app's. React keeps a component instance across branches only
 * when its position matches — put it in the `main` branch alone and opening Settings
 * destroys every simulator in the window.
 *
 * DOM order inside the layer is load-bearing: backdrop, then devices, then chrome.
 * See `DeviceOverlaySurface`.
 */
export function DeviceHostLayer() {
  const sessionIds = useDevicePipStore(useShallow(selectHostedDeviceSessions))
  // Read separately, then combined: `useSashResizing() || useGlobalDragging()` would
  // short-circuit past a hook call.
  const sashResizing = useSashResizing()
  const globalDragging = useGlobalDragging()
  const yielding = sashResizing || globalDragging
  const overlayOpen = useDevicePipStore((state) => state.expandedSessionId != null)
  // Mounted here rather than in the preview: this is what decides which sessions get
  // a panel at all, and it has to keep deciding while no preview is on screen.
  useDeviceHandover()

  return (
    <div
      data-device-host-layer=""
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        // Above the mini-app (30) and browser (20) layers at rest, and above the
        // browser's expanded overlay (50) when this one is up.
        zIndex: overlayOpen ? 51 : 40,
      }}
    >
      <DeviceOverlaySurface />
      {sessionIds.map((sessionId) => (
        <PersistentDevice key={sessionId} sessionId={sessionId} yielding={yielding} />
      ))}
      <DevicePictureInPicture />
    </div>
  )
}

function PersistentDevice({ sessionId, yielding }: { sessionId: string; yielding: boolean }) {
  const panelSlot = useDevicePipStore((state) => state.slots[sessionId])
  const pipSlot = useDevicePipStore((state) => state.pipSlots[sessionId])
  const overlaySlot = useDevicePipStore((state) => state.overlaySlots[sessionId])
  const expanded = useDevicePipStore((state) => state.expandedSessionId === sessionId)
  const activityShown = useActivityPanelStore((state) => state.showPanel)

  /**
   * Which surface wins, in the order the preview itself already encodes: the tab
   * whenever the Activity panel is up, the expanded overlay next, the floating
   * preview last.
   *
   * The `activityShown` test is not redundant with `panelSlot` existing. In mosaic
   * mode the panel is forced hidden but dockview still reports a live layout rect —
   * clipping does not change `getBoundingClientRect` — so a stale panel slot would
   * otherwise win and paint the device into a rect nothing can see.
   */
  const slot: DeviceSlot | undefined = activityShown
    ? panelSlot
    : expanded
      ? overlaySlot
      : pipSlot
  // What to lay the panel out AS while it has nowhere to be. Keeping the last known
  // size means the device comes back at the shape it left rather than reflowing from
  // a collapsed box on the frame it reappears.
  const restingSlot = slot ?? panelSlot ?? overlaySlot ?? pipSlot
  // A slot with no area is a surface that exists but is not being shown — dockview
  // keeps an inactive tab in the DOM at zero size — and is not somewhere to draw.
  const winning = slot && slot.width > 0 && slot.height > 0 ? slot : undefined
  const mode = winning?.mode ?? restingSlot?.mode ?? 'panel'

  return (
    <div
      data-device-host=""
      data-session-id={sessionId}
      data-device-presentation={mode}
      style={{
        position: 'absolute',
        left: winning ? winning.left : PARKED_LEFT,
        top: winning ? winning.top : 0,
        width: restingSlot?.width || FALLBACK_SLOT.width,
        height: restingSlot?.height || FALLBACK_SLOT.height,
        opacity: winning ? 1 : 0,
        // Parked off-screen rather than `display: none`: the stage measures its own
        // device body to size the overlay toolbar, and a display-less subtree reports
        // zeros for all of it. Off-screen it keeps laying out honestly for free.
        // Never faded or transitioned — a handover has to be a cut, not a dissolve.
        // The pip's shadow follows the device's silhouette rather than this box,
        // which is why it is a filter here and not a `shadow-*` on the preview: the
        // preview is an empty rect now, and a drop-shadow of nothing is nothing.
        filter: mode === 'pip' ? 'drop-shadow(0 10px 24px rgb(0 0 0 / 0.45))' : undefined,
        // The pip is look-only — the whole surface belongs to the drag gesture in the
        // chrome above. While a sash or a tab is being dragged everything yields, or
        // this fixed layer eats dockview's resize bars and drop targets.
        pointerEvents: winning && mode !== 'pip' && !yielding ? 'auto' : 'none',
      }}
    >
      <DevicePanel
        sessionId={sessionId}
        variant={mode === 'pip' ? 'preview' : mode === 'overlay' ? 'overlay' : 'panel'}
      />
    </div>
  )
}
