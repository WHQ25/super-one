import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleAlert, FileDown, FolderDown, ImageDown, MoreHorizontal, Share2, X } from 'lucide-react-native'
import {
  ActivityIndicator,
  Animated,
  Modal,
  PanResponder,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type NativeTouchEvent,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  describeSaveOutcome,
  FILE_PREVIEW_TEXT,
  filePreviewMenu,
  formatFileSize,
  previewLocalSource,
  type FilePreviewState,
} from '../file-preview-state'
import {
  DOUBLE_TAP_MS,
  IDENTITY_TRANSFORM,
  MIN_SCALE,
  TAP_SLOP,
  doubleTapTransform,
  fitImage,
  panTransform,
  pinchTransform,
  settleTransform,
  touchDistance,
  touchMidpoint,
  type ImageTransform,
  type Point,
  type Size,
} from '../image-preview-state'
import type { MediaPorts } from '../media-ports'
import { useMobileLocale } from '../i18n/context'
import { NativeMarkdown } from '../prompts/NativeMarkdown'
import { monospace, tint } from '../prompts/styles'
import { useMobileTheme } from '../theme/context'
import { AnchoredMenu, MenuRow, useMenuAnchor } from './anchored-menu'
import { highlightLines } from './code-highlight'
import { IconButton } from './icon-button'
import { MenuHost } from './menu-host'
import { Button } from './primitives'
import { SCROLL_INDICATOR_GUTTER } from './scroll-gutter'
import { Text } from './text'

export type FilePreviewModalProps = {
  /** What to show; `null` keeps the modal closed. */
  state: FilePreviewState | null
  ports: MediaPorts
  onDismiss: () => void
  /** Approve a relay transfer the page is waiting on. */
  onStartTransfer: () => void
  onRetry: () => void
}

/** How long a success line stays before the chrome goes quiet again. */
const FEEDBACK_MS = 2500

/**
 * The one fullscreen surface every picture and file on the phone opens into —
 * a tap on a transcript image, a file chip, or a row in the Files browser.
 *
 * The body follows `state.kind`: a zoomable picture, a code listing or prose,
 * a transfer card while bytes are still on the desktop, or the loading and
 * error states around them. The chrome is the same throughout — close, the
 * file name, and a menu with the only two things worth doing with a file on a
 * phone: keep a copy, or hand it to another app.
 */
export function FilePreviewModal({ state, ports, onDismiss, onStartTransfer, onRetry }: FilePreviewModalProps) {
  const { tokens: { colors } } = useMobileTheme()
  return (
    <Modal
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape-left', 'landscape-right']}
      transparent
      visible={!!state}
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onDismiss}
    >
      {state ? (
        // A native Modal is its own window, so menus need a host of their own inside it.
        <MenuHost>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} accessibilityViewIsModal onAccessibilityEscape={onDismiss}>
            <PreviewBody state={state} onDismiss={onDismiss} onStartTransfer={onStartTransfer} onRetry={onRetry} />
            <PreviewChrome state={state} ports={ports} onDismiss={onDismiss} />
          </View>
        </MenuHost>
      ) : null}
    </Modal>
  )
}

/** Height the chrome row takes; in-flow bodies start below it. */
const CHROME_ROW_HEIGHT = 48

function PreviewBody({ state, onDismiss, onStartTransfer, onRetry }: Omit<FilePreviewModalProps, 'ports' | 'state'> & { state: FilePreviewState }) {
  const { tokens: { colors, spacing } } = useMobileTheme()
  const { t } = useMobileLocale()
  const insets = useSafeAreaInsets()
  // The picture sits under the chrome so it can use the whole screen; every
  // other body starts below it, or its first lines would be covered.
  const offset = state.kind === 'image' ? undefined : { paddingTop: insets.top + CHROME_ROW_HEIGHT }

  if (state.kind === 'image') {
    return <ZoomableImage key={state.src} src={state.src} label={state.label ?? state.name} onDismiss={onDismiss} />
  }

  if (state.kind === 'loading') {
    return (
      <View style={[styles.center, offset]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{t(FILE_PREVIEW_TEXT.loading)}</Text>
      </View>
    )
  }

  if (state.kind === 'error') {
    return (
      <View style={[styles.center, offset, { paddingHorizontal: spacing.lg }]}>
        <CircleAlert color={colors.error} size={28} />
        <Text accessibilityRole="alert" style={{ color: colors.error, fontSize: 13, textAlign: 'center' }}>{state.message}</Text>
        <Button label={FILE_PREVIEW_TEXT.retry} variant="secondary" onPress={onRetry} />
      </View>
    )
  }

  if (state.kind === 'transfer') {
    return (
      <View style={[styles.center, offset, { paddingHorizontal: spacing.lg }]}>
        <FileDown color={colors.primary} size={28} />
        <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '500', textAlign: 'center' }}>{state.name}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{formatFileSize(state.size)} · {state.mimeType}</Text>
        {state.phase === 'ready'
          ? <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>{t(FILE_PREVIEW_TEXT.ready)}</Text>
          : <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>
            {t(state.needsConfirm ? FILE_PREVIEW_TEXT.relayNotice : FILE_PREVIEW_TEXT.lanNotice)}
          </Text>}
        {state.phase === 'downloading'
          ? <View style={styles.inline}>
            <ActivityIndicator color={colors.mutedForeground} size="small" />
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{t(FILE_PREVIEW_TEXT.downloading)}</Text>
          </View>
          : state.phase === 'idle' && state.needsConfirm
            ? <Button label={FILE_PREVIEW_TEXT.download} icon={FileDown} onPress={onStartTransfer} />
            : null}
      </View>
    )
  }

  if (state.markdown) {
    return (
      <ScrollView style={styles.flex}
        contentContainerStyle={{ ...offset, padding: spacing.md, paddingRight: SCROLL_INDICATOR_GUTTER + spacing.md, paddingBottom: spacing.xl }}>
        <NativeMarkdown content={state.text} />
      </ScrollView>
    )
  }

  return <CodeListing text={state.text} name={state.name} line={state.line} topInset={offset?.paddingTop ?? 0} />
}

/** Close, title and the more menu, laid over the body inside the safe area. */
function PreviewChrome({ state, ports, onDismiss }: { state: FilePreviewState; ports: MediaPorts; onDismiss: () => void }) {
  const { tokens: { colors, spacing } } = useMobileTheme()
  const { t } = useMobileLocale()
  const insets = useSafeAreaInsets()
  const menu = useMenuAnchor()
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ message: string; tone: 'info' | 'error'; offerSettings?: boolean } | null>(null)
  const actions = filePreviewMenu(state)
  const title = state.kind === 'image' ? state.label ?? state.name : state.name
  // The picture uses the whole screen, so the chrome floats over it; every
  // other body starts below the row and the chrome paints a solid background.
  const overlay = state.kind === 'image'

  useEffect(() => {
    if (!feedback || feedback.tone === 'error' || feedback.offerSettings) return
    const handle = setTimeout(() => setFeedback(null), FEEDBACK_MS)
    return () => clearTimeout(handle)
  }, [feedback])

  const run = async (action: () => Promise<{ message: string; offerSettings: boolean } | null>) => {
    menu.close()
    if (busy) return
    setBusy(true)
    setFeedback(null)
    try {
      const result = await action()
      if (result) setFeedback({ message: result.message, tone: result.offerSettings ? 'error' : 'info', offerSettings: result.offerSettings })
    } catch (cause) {
      setFeedback({ message: cause instanceof Error ? cause.message : String(cause), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const save = () => run(async () => {
    const source = previewLocalSource(state)
    if (!source) return null
    return describeSaveOutcome(await ports.save(source, actions.save.toPhotos))
  })
  const share = () => run(async () => {
    const source = previewLocalSource(state)
    if (source) await ports.share(source)
    return null
  })

  return (
    <View pointerEvents="box-none" style={[styles.chrome, { paddingTop: insets.top, paddingHorizontal: spacing.xs }, overlay ? null : { backgroundColor: colors.background }]}>
      <View style={styles.chromeRow}>
        <IconButton icon={X} label="Close" onPress={onDismiss} chrome="plain" color={colors.foreground} />
        <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        <IconButton buttonRef={menu.ref} icon={MoreHorizontal} label={FILE_PREVIEW_TEXT.more} onPress={menu.open}
          chrome="plain" color={colors.foreground} spinning={busy} disabled={busy} />
      </View>
      {feedback ? (
        <View style={styles.feedbackRow}>
          <Text style={[styles.feedback, { color: feedback.tone === 'error' ? colors.error : colors.mutedForeground }]}>{t(feedback.message)}</Text>
          {feedback.offerSettings ? <Button label={FILE_PREVIEW_TEXT.openSettings} variant="secondary" onPress={ports.openSettings} /> : null}
        </View>
      ) : null}
      <AnchoredMenu anchor={menu.anchor} title={FILE_PREVIEW_TEXT.menuTitle} onDismiss={menu.close} width={240}>
        <MenuRow label={actions.save.toPhotos ? FILE_PREVIEW_TEXT.saveToPhotos : FILE_PREVIEW_TEXT.saveToFiles}
          leading={actions.save.toPhotos
            ? <ImageDown size={18} color={colors.mutedForeground} />
            : <FolderDown size={18} color={colors.mutedForeground} />}
          disabled={!actions.save.enabled} onPress={() => void save()} />
        <MenuRow label={FILE_PREVIEW_TEXT.share} leading={<Share2 size={18} color={colors.mutedForeground} />}
          disabled={!actions.share.enabled} onPress={() => void share()} />
      </AnchoredMenu>
    </View>
  )
}

function touchPoint(touch: NativeTouchEvent): Point {
  return { x: touch.pageX, y: touch.pageY }
}

/**
 * The picture plus its gestures: pinch and drag to zoom, double tap to toggle,
 * a single tap on the fitted picture to leave. Transform state lives in refs
 * and is pushed straight into `Animated.Value`s: a pinch reports dozens of
 * moves a second, and a React render per move would make it stutter.
 */
function ZoomableImage({ src, label, onDismiss }: { src: string; label: string; onDismiss: () => void }) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const { width, height } = useWindowDimensions()
  const [imageSize, setImageSize] = useState<Size | null>(null)
  const [failed, setFailed] = useState(false)

  const viewport: Size = { width, height }
  const fitted = fitImage(viewport, imageSize ?? viewport)
  // The gesture handlers are created once; they read the live layout from here.
  const layout = useRef({ viewport, fitted })
  layout.current = { viewport, fitted }
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss

  const scale = useRef(new Animated.Value(1)).current
  const translateX = useRef(new Animated.Value(0)).current
  const translateY = useRef(new Animated.Value(0)).current
  const transform = useRef<ImageTransform>(IDENTITY_TRANSFORM)
  const pinch = useRef<(ImageTransform & { focal: Point; distance: number }) | null>(null)
  const lastTouch = useRef<Point | null>(null)
  const grant = useRef<{ at: number; point: Point; moved: boolean; fingers: number } | null>(null)
  const lastTap = useRef<{ at: number; point: Point } | null>(null)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (tapTimer.current) clearTimeout(tapTimer.current) }, [])

  /** Coordinates relative to the viewport centre, which is what the geometry expects. */
  const relative = (point: Point): Point => ({
    x: point.x - layout.current.viewport.width / 2,
    y: point.y - layout.current.viewport.height / 2,
  })
  const apply = (next: ImageTransform) => {
    transform.current = next
    scale.setValue(next.scale)
    translateX.setValue(next.translate.x)
    translateY.setValue(next.translate.y)
  }
  const animateTo = (next: ImageTransform) => {
    transform.current = next
    const spring = (value: Animated.Value, toValue: number) => Animated.spring(value, { toValue, useNativeDriver: true, speed: 20, bounciness: 4 })
    Animated.parallel([
      spring(scale, next.scale),
      spring(translateX, next.translate.x),
      spring(translateY, next.translate.y),
    ]).start()
  }

  const handleTap = (point: Point) => {
    const now = Date.now()
    const previous = lastTap.current
    if (previous && now - previous.at < DOUBLE_TAP_MS && touchDistance(previous.point, point) < TAP_SLOP * 3) {
      if (tapTimer.current) clearTimeout(tapTimer.current)
      tapTimer.current = null
      lastTap.current = null
      animateTo(doubleTapTransform(transform.current, relative(point), layout.current.viewport, layout.current.fitted))
      return
    }
    lastTap.current = { at: now, point }
    // A single tap on the fitted picture closes — but only once it is clear no
    // second tap is coming, or a double tap would close the viewer instead of zooming.
    if (transform.current.scale <= MIN_SCALE) {
      tapTimer.current = setTimeout(() => {
        tapTimer.current = null
        lastTap.current = null
        dismiss.current()
      }, DOUBLE_TAP_MS)
    }
  }

  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event: GestureResponderEvent) => {
      const point = touchPoint(event.nativeEvent)
      grant.current = { at: Date.now(), point, moved: false, fingers: 1 }
      lastTouch.current = point
      pinch.current = null
    },
    onPanResponderMove: (event: GestureResponderEvent) => {
      const touches = event.nativeEvent.touches
      const state = grant.current
      if (!state) return
      if (touches.length >= 2) {
        state.fingers = Math.max(state.fingers, touches.length)
        state.moved = true
        lastTouch.current = null
        const a = touchPoint(touches[0])
        const b = touchPoint(touches[1])
        const focal = relative(touchMidpoint(a, b))
        const distance = touchDistance(a, b)
        if (!pinch.current) {
          pinch.current = { ...transform.current, focal, distance }
          return
        }
        apply(pinchTransform(pinch.current, { focal, distance }))
        return
      }
      if (touches.length === 0) return
      // A finger lifted mid-pinch: carry on as a pan from wherever the other one is.
      pinch.current = null
      const point = touchPoint(touches[0])
      if (lastTouch.current) {
        const delta = { x: point.x - lastTouch.current.x, y: point.y - lastTouch.current.y }
        if (transform.current.scale > MIN_SCALE) apply(panTransform(transform.current, delta))
      }
      if (touchDistance(state.point, point) > TAP_SLOP) state.moved = true
      lastTouch.current = point
    },
    onPanResponderRelease: (event: GestureResponderEvent) => {
      const state = grant.current
      grant.current = null
      pinch.current = null
      lastTouch.current = null
      const settled = settleTransform(transform.current, layout.current.viewport, layout.current.fitted)
      if (settled !== transform.current) animateTo(settled)
      if (state && !state.moved && state.fingers === 1) handleTap(touchPoint(event.nativeEvent))
    },
    onPanResponderTerminate: () => {
      grant.current = null
      pinch.current = null
      lastTouch.current = null
      animateTo(settleTransform(transform.current, layout.current.viewport, layout.current.fitted))
    },
  })).current

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
          style={{ width: fitted.width, height: fitted.height, transform: [{ translateX }, { translateY }, { scale }] }}
        />
      )}
      {!imageSize && !failed ? (
        <View style={styles.spinner} pointerEvents="none">
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : null}
    </View>
  )
}

/** Line height of one code row; the anchor scroll is computed from it. */
const CODE_LINE_HEIGHT = 19

/**
 * A numbered listing that scrolls both ways. One `Text` per row rather than a
 * single block, so the cited line can carry its own background and the gutter
 * can stay aligned with wrapped-off long lines — the horizontal scroller means
 * rows never wrap, which is what keeps the two columns in step. Tokens are
 * nested `Text` runs inside the row, coloured from the GitHub palette that
 * matches the current scheme.
 */
function CodeListing({ text, name, line, topInset }: { text: string; name: string; line?: number; topInset: number }) {
  const { tokens: { colors, scheme } } = useMobileTheme()
  const scrollRef = useRef<ScrollView>(null)
  const lines = useMemo(() => highlightLines(text, name, scheme), [text, name, scheme])
  const gutterWidth = `${lines.length}`.length

  // Anchor on the cited line once the rows exist; a few rows of context above
  // it keep the highlighted row from sitting flush against the header.
  useEffect(() => {
    if (line == null || line < 1) return
    const target = Math.max(0, line - 4) * CODE_LINE_HEIGHT
    const handle = setTimeout(() => scrollRef.current?.scrollTo({ y: target, animated: false }), 0)
    return () => clearTimeout(handle)
  }, [line, lines.length])

  return (
    <ScrollView ref={scrollRef} style={[styles.flex, { marginTop: topInset }]} contentContainerStyle={{ paddingBottom: 24 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }}>
        <View>
          {lines.map((row, index) => {
            const number = index + 1
            const highlighted = number === line
            return (
              <View
                key={number}
                testID={highlighted ? 'file-preview-cited-line' : undefined}
                style={[styles.row, highlighted && { backgroundColor: tint(colors.primary, '22') }]}
              >
                <Text selectable={false} style={[styles.code, styles.gutter, { color: colors.mutedForeground, width: gutterWidth * 8 + 16 }]}>
                  {`${number}`.padStart(gutterWidth, ' ')}
                </Text>
                <Text selectable style={[styles.code, { color: colors.foreground }]}>
                  {row.length === 0
                    ? ' '
                    : row.map((span, spanIndex) => (
                      <Text
                        key={spanIndex}
                        style={span.color || span.bold || span.italic
                          ? {
                            ...(span.color ? { color: span.color } : {}),
                            ...(span.bold ? { fontWeight: '700' as const } : {}),
                            ...(span.italic ? { fontStyle: 'italic' as const } : {}),
                          }
                          : undefined}
                      >
                        {span.text}
                      </Text>
                    ))}
                </Text>
              </View>
            )
          })}
        </View>
      </ScrollView>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  spinner: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  chrome: { position: 'absolute', top: 0, left: 0, right: 0 },
  chromeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, height: CHROME_ROW_HEIGHT },
  title: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '600' },
  feedbackRow: { alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  feedback: { textAlign: 'center', fontSize: 12 },
  row: { flexDirection: 'row', paddingRight: 16 },
  code: { fontFamily: monospace, fontSize: 12, lineHeight: CODE_LINE_HEIGHT },
  gutter: { textAlign: 'right', paddingLeft: 8, paddingRight: 8, opacity: 0.7 },
})
