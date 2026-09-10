import { useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw, RotateCw } from 'lucide-react-native'
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  StyleSheet,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type NativeTouchEvent,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FILE_PREVIEW_TEXT } from '../file-preview-state'
import { createImageGesture, IMAGE_GESTURE_RESPONDER_POLICY, type GestureTouch } from '../image-gesture'
import {
  IDENTITY_TRANSFORM,
  fitImage,
  quarterTurnTransform,
  rotationFitScale,
  settleTransform,
  type ImageTransform,
  type Size,
} from '../image-preview-state'
import { useMobileLocale } from '../i18n/context'
import { useMobileTheme } from '../theme/context'
import { IconButton } from './icon-button'
import { Text } from './text'
import { useFade } from './use-fade'

function touchPoint(touch: NativeTouchEvent): GestureTouch {
  return { x: touch.pageX, y: touch.pageY }
}

function touchList(event: GestureResponderEvent): GestureTouch[] {
  const touches = event.nativeEvent.touches
  // A release event reports no active touches; fall back to the one that ended.
  return touches.length > 0 ? touches.map(touchPoint) : [touchPoint(event.nativeEvent)]
}

/**
 * The picture plus its gestures: pinch to zoom, two fingers to turn, drag to
 * pan, double tap to toggle the zoom, single tap to get the chrome out of the
 * way. Nothing here dismisses the viewer — that is the back button's job, so a
 * finger put down on the picture can never lose it.
 *
 * Transform state lives in refs and is pushed straight into `Animated.Value`s:
 * a pinch reports dozens of moves a second, and a React render per move would
 * make it stutter. Rotation is a pure transform too — the picture is laid out
 * once at its upright fit and `rotationFitScale` scales it back inside the
 * screen — so a whole turn stays on the native driver.
 */
export function ZoomableImage({ src, label, chromeVisible, onToggleChrome }: {
  src: string
  label: string
  /** Whether the overlay chrome is showing; the rotate bar rides along with it. */
  chromeVisible: boolean
  onToggleChrome: () => void
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { t } = useMobileLocale()
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const [imageSize, setImageSize] = useState<Size | null>(null)
  const [failed, setFailed] = useState(false)

  const viewport: Size = { width, height }
  const fitted = fitImage(viewport, imageSize ?? viewport)
  // The gesture reads the live layout from here at every event.
  const layout = useRef({ viewport, fitted })
  layout.current = { viewport, fitted }
  const toggleChrome = useRef(onToggleChrome)
  toggleChrome.current = onToggleChrome

  const scale = useRef(new Animated.Value(1)).current
  const translateX = useRef(new Animated.Value(0)).current
  const translateY = useRef(new Animated.Value(0)).current
  const rotation = useRef(new Animated.Value(0)).current
  // Degrees in, a rotation string out; the identity range extrapolates, so it
  // covers a turn past 360° or below zero without any wrapping.
  const rotate = useMemo(() => rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '1deg'] }), [rotation])
  const transform = useRef<ImageTransform>(IDENTITY_TRANSFORM)

  /** The scale actually rendered: the user's zoom on top of the turned fit. */
  const renderedScale = (next: ImageTransform) =>
    rotationFitScale(next.rotation, layout.current.viewport, layout.current.fitted) * next.scale
  const apply = (next: ImageTransform) => {
    transform.current = next
    scale.setValue(renderedScale(next))
    translateX.setValue(next.translate.x)
    translateY.setValue(next.translate.y)
    rotation.setValue(next.rotation)
  }
  const animateTo = (next: ImageTransform) => {
    const rendered = renderedScale(next)
    transform.current = next
    const spring = (value: Animated.Value, toValue: number) => Animated.spring(value, { toValue, useNativeDriver: true, speed: 20, bounciness: 4 })
    Animated.parallel([
      spring(scale, rendered),
      spring(translateX, next.translate.x),
      spring(translateY, next.translate.y),
      spring(rotation, next.rotation),
    ]).start()
  }
  const animateRef = useRef(animateTo)
  animateRef.current = animateTo

  // The fit changes when the bytes report their size and again on every device
  // rotation; a picture zoomed or turned at the time has to settle into it.
  useEffect(() => {
    animateRef.current(settleTransform(transform.current, { width, height }, layout.current.fitted))
  }, [width, height, imageSize])

  const gesture = useRef(createImageGesture({
    layout: () => layout.current,
    current: () => transform.current,
    apply: (next) => apply(next),
    animateTo: (next) => animateRef.current(next),
    onSingleTap: () => toggleChrome.current(),
    now: () => Date.now(),
  })).current

  const responder = useRef(PanResponder.create({
    ...IMAGE_GESTURE_RESPONDER_POLICY,
    onPanResponderGrant: (event) => gesture.grant(touchList(event)),
    onPanResponderMove: (event) => gesture.move(touchList(event)),
    onPanResponderRelease: (event) => gesture.release(touchPoint(event.nativeEvent)),
    onPanResponderTerminate: () => gesture.terminate(),
  })).current

  const barOpacity = useFade(chromeVisible)
  const turn = (quarters: number) => animateTo(quarterTurnTransform(transform.current, quarters))

  return (
    <View style={styles.stage} {...responder.panHandlers}>
      {failed ? (
        <Text style={{ color: colors.mutedForeground }}>{t(FILE_PREVIEW_TEXT.imageFailed)}</Text>
      ) : (
        <Animated.Image
          accessibilityRole="image"
          accessibilityLabel={label}
          source={{ uri: src }}
          resizeMode="contain"
          onLoad={(event) => {
            const source = event.nativeEvent.source
            if (source?.width && source?.height) setImageSize({ width: source.width, height: source.height })
            else setImageSize(viewport)
          }}
          onError={() => setFailed(true)}
          style={{ width: fitted.width, height: fitted.height, transform: [{ translateX }, { translateY }, { scale }, { rotate }] }}
        />
      )}
      {!imageSize && !failed ? (
        <View style={styles.spinner} pointerEvents="none">
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : null}
      {failed ? null : (
        <Animated.View
          pointerEvents={chromeVisible ? 'box-none' : 'none'}
          style={[styles.bar, { bottom: insets.bottom + 16, opacity: barOpacity }]}
        >
          <View style={[styles.barInner, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.pill }]}>
            <IconButton icon={RotateCcw} label={FILE_PREVIEW_TEXT.rotateLeft} onPress={() => turn(-1)} chrome="plain" color={colors.foreground} />
            <IconButton icon={RotateCw} label={FILE_PREVIEW_TEXT.rotateRight} onPress={() => turn(1)} chrome="plain" color={colors.foreground} />
          </View>
        </Animated.View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  spinner: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  bar: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  barInner: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 4, borderWidth: StyleSheet.hairlineWidth },
})
