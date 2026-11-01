import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, ScrollView, View } from 'react-native'
import { Canvas, LinearGradient, Rect, vec } from '@shopify/react-native-skia'
import Animated from 'react-native-reanimated'
import { sessionRowEntering } from './session-unfold-motion'
import { useMobileTheme } from '../theme/context'

/** Desktop `max-h-64`. A short list stays at its content height. */
export const SESSION_LIST_MAX_HEIGHT = 256
/** Desktop `max-h-36`. An expanded parent's children scroll inside the project list. */
export const SESSION_CHILD_LIST_MAX_HEIGHT = 144
/** Single-line row (38) plus the floating swipe row's gap. */
const ROW_ESTIMATE = 40
/**
 * Taller than a child list (`144`) and shorter than the project cap (`256`).
 * A row that stretches to the scroller reports the viewport; keeping that
 * number pushes every later row past the clip.
 */
const MAX_ROW_HEIGHT = 200
const OVERSCAN = 8
/** Same near-bottom prefetch as the desktop active and settled lists. */
const SCROLL_PREFETCH = 300
const LOADING_HEIGHT = 36
/** Desktop `scroll-edge-fade-y` is 24px and only on an edge that still hides rows. */
const EDGE_FADE = 24

/** A list that fits has neither fade. Each edge fades only while it still clips a row. */
export function sessionListFades(scrollY: number, viewport: number, content: number): { top: boolean; bottom: boolean } {
  const overflows = content > viewport + 1
  return {
    top: overflows && scrollY > 1,
    bottom: overflows && scrollY + viewport < content - 1,
  }
}

/**
 * One project's session rows in their own scroller. Pages load as the scroll
 * nears the bottom. Only the visible window is mounted, so a project that has
 * already loaded many pages does not mount every row.
 */
export function VirtualSessionList(props: {
  count: number
  getKey: (index: number) => string | number
  renderItem: (index: number) => ReactNode
  hasMore?: boolean
  /**
   * Changes when a page arrives, even if those rows are hidden children and
   * `count` stays put. The list asks for the next page once per token.
   */
  loadToken?: number
  loadingMore?: boolean
  onLoadMore?: () => void | Promise<void>
  /** Stagger the first window. Later rows, including ones scrolled in, stay put. */
  animate?: boolean
  /** Defaults to the project cap. A child list passes the shorter desktop cap. */
  maxHeight?: number
  testID?: string
}) {
  const { tokens: { colors } } = useMobileTheme()
  const [sizes, setSizes] = useState<number[]>([])
  const [anchor, setAnchor] = useState(0)
  const [width, setWidth] = useState(0)
  const [fades, setFades] = useState({ top: false, bottom: false })
  const offsets = layoutOffsets(props.count, sizes)
  const total = offsets[props.count] ?? 0
  const contentHeight = total + (props.loadingMore ? LOADING_HEIGHT : 0)
  const height = Math.min(props.maxHeight ?? SESSION_LIST_MAX_HEIGHT, contentHeight)
  // The expand stagger plays for the window mounted with the list. Rows that
  // mount later, because the window moved or a page arrived, stay still.
  const allowEnter = useRef(props.animate === true)
  useEffect(() => { allowEnter.current = false }, [])
  const scrollY = useRef(0)
  const anchorRef = useRef(0)
  const requestedCount = useRef(-1)
  const hasMoreRef = useRef(props.hasMore)
  const onLoadMoreRef = useRef(props.onLoadMore)
  const tokenRef = useRef(props.loadToken ?? props.count)
  const totalRef = useRef(total)
  const heightRef = useRef(height)
  const loadingRef = useRef(props.loadingMore === true)
  const fadesRef = useRef(fades)
  hasMoreRef.current = props.hasMore
  onLoadMoreRef.current = props.onLoadMore
  tokenRef.current = props.loadToken ?? props.count
  totalRef.current = total
  heightRef.current = height
  loadingRef.current = props.loadingMore === true

  const maybeLoad = useCallback(() => {
    const load = onLoadMoreRef.current
    if (!hasMoreRef.current || !load) return
    if (requestedCount.current === tokenRef.current) return
    const remaining = totalRef.current - (scrollY.current + heightRef.current)
    const short = totalRef.current <= heightRef.current + 1
    if (remaining >= SCROLL_PREFETCH && !short) return
    requestedCount.current = tokenRef.current
    void Promise.resolve(load())
  }, [])

  useEffect(() => { maybeLoad() }, [props.count, props.loadToken, total, height, props.hasMore, maybeLoad])

  const publishFades = useCallback((y: number) => {
    const content = totalRef.current + (loadingRef.current ? LOADING_HEIGHT : 0)
    const next = sessionListFades(y, heightRef.current, content)
    if (next.top === fadesRef.current.top && next.bottom === fadesRef.current.bottom) return
    fadesRef.current = next
    setFades(next)
  }, [])

  useEffect(() => { publishFades(scrollY.current) }, [total, height, props.loadingMore, publishFades])

  const onMeasure = useCallback((index: number, measured: number) => {
    const next = Math.round(measured)
    if (next <= 0 || next > MAX_ROW_HEIGHT) return
    setSizes((current) => {
      if (current[index] === next) return current
      const copy = current.slice()
      copy[index] = next
      return copy
    })
  }, [])

  const from = Math.max(0, anchor - OVERSCAN)
  let to = Math.min(props.count - 1, anchor)
  const limit = scrollY.current + height
  while (to < props.count - 1 && (offsets[to + 1] ?? 0) < limit) to += 1
  to = Math.min(props.count - 1, to + OVERSCAN)
  const indexes = props.count === 0 ? [] : range(from, to)

  // ScrollView's own style grows (`flexGrow: 1`). Inside the drawer's scroller
  // that growth becomes an empty band, so the frame stays at the capped height.
  const frame = { height, flexGrow: 0, flexShrink: 0 }
  return (
    <View
      style={frame}
      onLayout={(event) => {
        const next = Math.round(event.nativeEvent.layout.width)
        setWidth((current) => current === next ? current : next)
      }}
    >
      <ScrollView
        testID={props.testID}
        style={frame}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={(event) => {
          scrollY.current = event.nativeEvent.contentOffset.y
          const next = indexAt(offsets, scrollY.current)
          if (next !== anchorRef.current) {
            anchorRef.current = next
            setAnchor(next)
          }
          publishFades(scrollY.current)
          maybeLoad()
        }}
      >
        <View style={{ height: contentHeight }}>
          {indexes.map((index) => (
            <MeasuredRow
              key={props.getKey(index)}
              index={index}
              offset={offsets[index] ?? 0}
              animate={allowEnter.current}
              onMeasure={onMeasure}
            >
              {props.renderItem(index)}
            </MeasuredRow>
          ))}
          {props.loadingMore ? (
            <ActivityIndicator
              testID="session-list-loading-more"
              color={colors.mutedForeground}
              style={{ position: 'absolute', top: total, left: 0, right: 0, height: LOADING_HEIGHT }}
            />
          ) : null}
        </View>
      </ScrollView>
      {fades.top ? <SessionListEdgeFade edge="top" color={colors.surface} width={width} /> : null}
      {fades.bottom ? <SessionListEdgeFade edge="bottom" color={colors.surface} width={width} /> : null}
    </View>
  )
}

/** Solid at the clipped edge, clear 24px in. The drawer and the tablet pane are both `surface`. */
function SessionListEdgeFade(props: { edge: 'top' | 'bottom'; color: string; width: number }) {
  const atTop = props.edge === 'top'
  return (
    <View
      pointerEvents="none"
      testID={atTop ? 'session-list-fade-top' : 'session-list-fade-bottom'}
      style={{ position: 'absolute', left: 0, right: 0, height: EDGE_FADE, ...(atTop ? { top: 0 } : { bottom: 0 }) }}
    >
      {props.width > 0 ? <Canvas style={{ width: props.width, height: EDGE_FADE }}>
        <Rect x={0} y={0} width={props.width} height={EDGE_FADE}>
          <LinearGradient
            start={vec(0, atTop ? 0 : EDGE_FADE)}
            end={vec(0, atTop ? EDGE_FADE : 0)}
            colors={[props.color, `${props.color}00`]}
          />
        </Rect>
      </Canvas> : null}
    </View>
  )
}

function MeasuredRow(props: {
  index: number
  offset: number
  animate: boolean
  onMeasure: (index: number, height: number) => void
  children: ReactNode
}) {
  // Captured once. A row that mounts because the window moved must not play
  // the expand animation again.
  const entering = useRef(props.animate ? sessionRowEntering(props.index) : null)
  return (
    <Animated.View
      {...(entering.current ? { entering: entering.current } : {})}
      onLayout={(event) => props.onMeasure(props.index, event.nativeEvent.layout.height)}
      // `top`, not translateY. The unfold animation owns `transform` and would
      // park every row at translateY 0, so the capped list looked empty.
      style={{ position: 'absolute', left: 0, right: 0, top: props.offset }}
    >
      {props.children}
    </Animated.View>
  )
}

function layoutOffsets(count: number, sizes: number[]): number[] {
  const offsets = new Array<number>(count + 1)
  offsets[0] = 0
  for (let index = 0; index < count; index += 1) {
    offsets[index + 1] = offsets[index]! + (sizes[index] ?? ROW_ESTIMATE)
  }
  return offsets
}

/** Largest item whose top is at or above `scrollY`. */
function indexAt(offsets: number[], scrollY: number): number {
  const last = offsets.length - 2
  if (last <= 0) return 0
  let low = 0
  let high = last
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if ((offsets[mid] ?? 0) <= scrollY) low = mid
    else high = mid - 1
  }
  return low
}

function range(from: number, to: number): number[] {
  const indexes: number[] = []
  for (let index = from; index <= to; index += 1) indexes.push(index)
  return indexes
}
