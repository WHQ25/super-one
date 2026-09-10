import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Animated, Modal, PanResponder, Pressable, useWindowDimensions, View } from 'react-native'
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

/**
 * The phone's equivalent of the desktop sidebar: every project and every session
 * lives here, and nowhere else. Chat sits directly on the device list, so this is
 * also how the user leaves a session without ending it.
 *
 * The contents are `WorkspaceList`, shared with the persistent `WorkspaceSidebar`
 * the shell shows once the window is wide enough to keep it open. This file owns
 * only what being a drawer adds: the scrim, the slide, and the drag that closes it.
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
  // back. The Modal's fade covers the frame before the spring starts.
  const slide = useRef(new Animated.Value(0)).current
  const { onDismiss } = props
  const settleOpen = useCallback(
    () => { Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 18 }).start() },
    [slide],
  )
  useEffect(() => {
    // Parked off-screen whenever hidden, so a drag that was released halfway
    // cannot leave the panel mid-slide the next time it opens.
    slide.setValue(-panelWidth)
    if (props.visible) settleOpen()
  }, [props.visible, panelWidth, settleOpen, slide])
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
        Animated.timing(slide, { toValue: -panelWidth, duration: 160, useNativeDriver: true }).start(onDismiss)
        return
      }
      settleOpen()
    },
    onPanResponderTerminate: settleOpen,
  }), [onDismiss, panelWidth, reveal, settleOpen, slide])

  const leave = (run: () => void) => { props.onDismiss(); run() }

  return <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onDismiss} supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}>
    <View style={{ flex: 1, backgroundColor: colors.scrim, flexDirection: 'row' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Close workspace')} onPress={props.onDismiss} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
      <Animated.View accessibilityViewIsModal {...drag.panHandlers}
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
  </Modal>
}
