import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, StyleSheet, View, useWindowDimensions, type StyleProp, type TextStyle } from 'react-native'
import { WebView } from 'react-native-webview'
import { Text } from './text'
import { useMobileTheme } from '../theme/context'
import { useIconMotion } from './use-icon-motion'
import { sessionTitleDocument } from './session-title-document'
import { SESSION_TITLE_OUT_MS, SESSION_TITLE_STAGGER_MS, SESSION_TITLE_FLIP_MS, SESSION_TITLE_TAIL_MS } from '@superone/shared/session-title-animation'

type Transition = { id: number; from: string; to: string }

/** Keep native text at rest; mount the shared CSS renderer only for a rename. */
export function AnimatedSessionTitle({ title, style }: { title: string; style?: StyleProp<TextStyle> }) {
  const motion = useIconMotion()
  const { tokens: { colors } } = useMobileTheme()
  const { fontScale } = useWindowDimensions()
  const [display, setDisplay] = useState(title)
  const displayed = useRef(title)
  const showTitle = useCallback((value: string) => { displayed.current = value; setDisplay(value) }, [])
  const [transition, setTransition] = useState<Transition | null>(null)
  const [ready, setReady] = useState(false)
  const previous = useRef(title)
  const sequence = useRef(0)
  const web = useRef<WebView>(null)
  const textStyle = StyleSheet.flatten(style) ?? {}
  useEffect(() => {
    if (!motion) {
      previous.current = title
      sequence.current++
      setTransition(null)
      showTitle(title)
      setReady(false)
      return
    }
    if (previous.current === title) return
    const from = displayed.current
    previous.current = title
    setReady(false)
    showTitle(from)
    setTransition({ id: ++sequence.current, from, to: title })
  }, [title, motion, showTitle])
  const finish = (id: number, next: string) => {
    if (sequence.current !== id) return
    showTitle(next)
    setTransition(null)
    setReady(false)
  }
  useEffect(() => {
    if (!transition) return
    // Native loading failures must never strand an invisible or stale title.
    const timeout = setTimeout(() => finish(transition.id, transition.to),
      3000 + SESSION_TITLE_OUT_MS + transition.to.length * SESSION_TITLE_STAGGER_MS + SESSION_TITLE_FLIP_MS + SESSION_TITLE_TAIL_MS)
    return () => clearTimeout(timeout)
  }, [transition])
  useEffect(() => {
    if (ready) web.current?.injectJavaScript('window.startTitleAnimation?.();true;')
  }, [ready, transition?.id])
  const html = useMemo(() => transition ? sessionTitleDocument({
    from: transition.from, to: transition.to,
    color: String(textStyle.color ?? colors.foreground), primary: colors.primary,
    fontSize: (textStyle.fontSize ?? 15) * fontScale,
    fontWeight: String(textStyle.fontWeight ?? '400'),
    fontFamily: textStyle.fontFamily ?? (Platform.OS === 'ios' ? '-apple-system, sans-serif' : 'Roboto, sans-serif'),
    textAlign: textStyle.textAlign === 'center' ? 'center' : 'left',
    letterSpacing: (textStyle.letterSpacing ?? 0) * fontScale,
  }) : '', [transition, textStyle.color, textStyle.fontSize, textStyle.fontWeight, textStyle.fontFamily, textStyle.letterSpacing, textStyle.textAlign, colors.foreground, colors.primary, fontScale])
  useEffect(() => { setReady(false) }, [html])
  const source = useMemo(() => ({ html }), [html])
  return <View accessible accessibilityLabel={title} style={{ minWidth: 0, maxWidth: '100%', width: '100%', flexShrink: 1 }}>
    <Text numberOfLines={1} style={[style, ready && { opacity: 0 }]}>{display}</Text>
    {transition ? <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { opacity: ready ? 1 : 0 }]}>
      <WebView key={transition.id} ref={web} source={source} originWhitelist={['about:*']}
        testID="session-title-animation" style={{ flex: 1, backgroundColor: 'transparent' }}
        scrollEnabled={false} bounces={false} javaScriptEnabled overScrollMode="never"
        onShouldStartLoadWithRequest={request => request.url === 'about:blank'}
        onError={() => finish(transition.id, transition.to)}
        onContentProcessDidTerminate={() => finish(transition.id, transition.to)}
        onRenderProcessGone={() => finish(transition.id, transition.to)}
        onMessage={event => {
          if (sequence.current !== transition.id) return
          let phase: unknown
          try { phase = JSON.parse(event.nativeEvent.data).phase } catch { return }
          if (phase === 'ready') setReady(true)
          if (phase === 'in') showTitle(transition.to)
          if (phase === 'done') finish(transition.id, transition.to)
        }} />
    </View> : null}
  </View>
}
