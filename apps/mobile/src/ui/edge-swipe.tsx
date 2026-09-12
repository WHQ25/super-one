import { useMemo, useRef } from 'react'
import { PanResponder, View } from 'react-native'

/**
 * Narrower than the transcript's own 14px gutter plus a hair, so the strip never
 * covers anything the reader can tap. Wider than that and it would start eating
 * the left edge of tool rows and links.
 */
const EDGE_WIDTH = 18
/** How far right the finger travels before the drawer is committed to. */
const OPEN_DISTANCE = 32

/**
 * An invisible strip down the left edge that fires on a rightward drag — the
 * gesture a phone user reaches for when they want the sidebar, or to leave a
 * fullscreen surface. On chat it opens the workspace drawer, the same edge the
 * native stack would otherwise spend on popping back to the device list; on the
 * file preview it stands in for the pop gesture a `Modal` never gets on iOS
 * (Android's system back gesture already covers that edge there).
 *
 * It never claims the touch that *starts* on it, only one that moves right, so a
 * tap or a vertical scroll begun in the gutter still behaves normally. It has to
 * be laid over the scroller rather than wrapped around it: a WebView runs its own
 * gestures natively, and an ancestor `View` gets no say in them.
 */
export function EdgeSwipeArea({ onSwipe }: { onSwipe: () => void }) {
  const fired = useRef(false)
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    // Rightward and mostly horizontal: a diagonal scroll must stay a scroll.
    onMoveShouldSetPanResponder: (_, gesture) =>
      gesture.dx > 6 && gesture.dx > Math.abs(gesture.dy) * 1.5,
    onPanResponderGrant: () => { fired.current = false },
    // Opening mid-drag rather than on release is what makes it read as a drawer
    // being pulled out instead of a swipe being graded after the fact.
    onPanResponderMove: (_, gesture) => {
      if (fired.current || gesture.dx < OPEN_DISTANCE) return
      fired.current = true
      onSwipe()
    },
  }), [onSwipe])

  return <View
    {...responder.panHandlers}
    testID="edge-swipe"
    // Landing/restore covers sit at elevation 4; this strip has to stay above
    // them or the drawer gesture dies on Android while the cover is up.
    style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: EDGE_WIDTH, zIndex: 2, elevation: 6 }}
  />
}
