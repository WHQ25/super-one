import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, BackHandler, Keyboard, PanResponder, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { DeviceStatus, ReconnectInfo } from '../device-status'
import { useMobileTheme } from '../theme/context'
import { SwipeRevealProvider, useSwipeRevealScope } from '../ui/swipe-reveal-scope'
import { useMobileLocale } from '../i18n/context'
import { SidebarDeviceFooter } from './sidebar-device-footer'
import { WorkspaceList, type WorkspaceListProps } from './workspace-list'

export type WorkspaceDrawerProps = Omit<WorkspaceListProps, 'onLeave'> & {
  onDismiss: () => void
  deviceName: string
  deviceStatus: DeviceStatus
  reconnect?: ReconnectInfo | null
  /** Drop the transport and return to the device list — the only way to another
   *  desktop, so the row itself is a readout, not a link. */
  onDisconnect: () => void
  onOpenAppSettings: () => void
}

/** The scrim's fade, and the slide-out that runs alongside it. */
const CLOSE_MS = 160

/**
 * The phone's equivalent of the desktop sidebar: every project and every session
 * lives here, and nowhere else. Chat sits directly on the device list, so this is
 * also how the user leaves a session without ending it.
 *
 * The contents are `WorkspaceList`, shared with the persistent `WorkspaceSidebar`
 * the shell shows once the window is wide enough to keep it open. This file owns
 * only what being a drawer adds: the scrim, the slide, and the drag that closes it.
 *
 * It is an overlay in the ordinary view tree, **not** an RN `Modal`. A `Modal` is
 * a second UIKit presentation, and that is where the session list broke on iOS:
 * Reanimated's layout animations inside a presented view left a reordered row
 * stuck invisible at its old frame, with its touch target overlapping the next
 * project, and UIKit's one-presentation-at-a-time rule made every sheet that
 * opened while the drawer was still fading out a race. Mounted last inside the
 * shell it paints over everything a `Modal` did, minus the second presentation.
 * The scrim covers the safe-area padding too: Yoga positions an absolute child
 * against the parent's padding box when its insets are given.
 *
 * It deliberately does NOT take the desktop's `--sidebar-*` palette, which in
 * light mode is a dark inverted chrome: at phone width that reads as a second app
 * rather than a panel of this one. Only the transcript carries harness colour.
 */
export function WorkspaceDrawer(props: WorkspaceDrawerProps) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()

  const panelWidth = Math.min(width - 40, 360)
  // The panel's own offset, so the same drag that pulled it out can push it
  // back. The scrim fades on its own value so a drag can leave it in place.
  const slide = useRef(new Animated.Value(-panelWidth)).current
  const scrim = useRef(new Animated.Value(0)).current
  // Stays mounted through the close animation; a `Modal` did the same natively.
  const [mounted, setMounted] = useState(props.visible)
  const { onDismiss, visible } = props
  const settleOpen = useCallback(
    () => { Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 18 }).start() },
    [slide],
  )
  const closeOut = useCallback((done?: () => void) => {
    Animated.timing(scrim, { toValue: 0, duration: CLOSE_MS, useNativeDriver: true }).start()
    Animated.timing(slide, { toValue: -panelWidth, duration: CLOSE_MS, useNativeDriver: true }).start(done)
  }, [panelWidth, scrim, slide])
  useEffect(() => {
    if (visible) {
      // Parked off-screen whenever hidden, so a drag that was released halfway
      // cannot leave the panel mid-slide the next time it opens.
      slide.setValue(-panelWidth)
      setMounted(true)
      Animated.timing(scrim, { toValue: 1, duration: CLOSE_MS, useNativeDriver: true }).start()
      settleOpen()
      return
    }
    // A flick already ran the slide-out before reporting the dismissal; the
    // timing then starts from where it ended and only unmounts.
    closeOut(({ finished } = { finished: true }) => { if (finished) setMounted(false) })
  }, [visible, panelWidth, closeOut, scrim, settleOpen, slide])
  useEffect(() => {
    // The drawer sits over the still-mounted composer. Leaving the keyboard up
    // covers the session list — the same unfocus Flutter's drawer does.
    if (visible) Keyboard.dismiss()
  }, [visible])
  useEffect(() => {
    // Android's back button closes the drawer, which a `Modal` did through
    // `onRequestClose`. Registered while open, so it sits above the chat
    // screen's own handler that opens the drawer.
    if (!visible) return
    const back = BackHandler.addEventListener('hardwareBackPress', () => { onDismiss(); return true })
    return () => back.remove()
  }, [visible, onDismiss])
  const reveal = useSwipeRevealScope()
  const drag = useMemo(() => PanResponder.create({
    // Leftward only: a rightward drag belongs to a session row's swipe actions,
    // and a closed row declines the leftward one so it reaches this responder.
    onMoveShouldSetPanResponder: (_, gesture) => {
      // A row with its actions showing owns that drag outright. There the
      // gesture means "put this row back", and closing the whole drawer instead
      // would throw away the panel the user was working in.
      if (reveal.anyRevealed()) return false
      return gesture.dx < -8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5
    },
    onPanResponderMove: (_, gesture) => { slide.setValue(Math.min(0, gesture.dx)) },
    onPanResponderRelease: (_, gesture) => {
      // A flick counts even when it is short: the distance test alone would
      // spring a fast, decisive gesture back open.
      if (gesture.dx < -56 || gesture.vx < -0.5) {
        closeOut(onDismiss)
        return
      }
      settleOpen()
    },
    onPanResponderTerminate: settleOpen,
  }), [closeOut, onDismiss, reveal, settleOpen, slide])

  const leave = (run: () => void) => { props.onDismiss(); run() }

  if (!mounted) return null
  return <View
    testID="workspace-drawer"
    style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}
    // Touches on the scrim close the drawer; nothing beneath may take them,
    // and VoiceOver must not wander back into the chat behind it. While the
    // close animation plays the shell is already the user's again.
    pointerEvents={visible ? 'auto' : 'none'}
    accessibilityViewIsModal
  >
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim, opacity: scrim }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Close workspace')} onPress={props.onDismiss} style={StyleSheet.absoluteFill} />
    </Animated.View>
    <Animated.View {...drag.panHandlers}
      style={{ width: panelWidth, backgroundColor: colors.surface, paddingTop: insets.top, paddingBottom: insets.bottom,
        borderRightWidth: 1, borderRightColor: colors.border, transform: [{ translateX: slide }] }}>
      <SwipeRevealProvider scope={reveal}>
        {/* Search and new session sit at the top. The device readout stays at
            the bottom — reaching another desktop means disconnecting from
            this one, so the row reports the link instead of offering to
            switch it. */}
        <WorkspaceList {...props} onLeave={props.onDismiss} />
        <SidebarDeviceFooter
          deviceName={props.deviceName}
          deviceStatus={props.deviceStatus}
          reconnect={props.reconnect}
          onDisconnect={() => leave(props.onDisconnect)}
          onOpenSettings={() => leave(props.onOpenAppSettings)}
        />
      </SwipeRevealProvider>
    </Animated.View>
  </View>
}
