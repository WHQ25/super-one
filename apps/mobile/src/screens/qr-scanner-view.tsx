import type { ReactNode } from 'react'
import { Pressable, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native'
import { useMobileLocale } from '../i18n/context'
import { useMobileTheme } from '../theme/context'
import { Button } from '../ui'
import { Text } from '../ui/text'
import { qrTargetRect, type QrCandidate, type ScannerSize } from './qr-scanner-state'

/** Presentation is shared by the live camera, stories and offline previews. */
export function QrScannerView(props: {
  preview: ReactNode
  candidates: QrCandidate[]
  size: ScannerSize
  error?: boolean
  onLayout: (event: LayoutChangeEvent) => void
  onSelect: (candidate: QrCandidate) => void
  onCancel: () => void
  onRetry: () => void
}) {
  const { tokens } = useMobileTheme()
  const { t } = useMobileLocale()
  const { fontScale } = useWindowDimensions()
  // A lone code submits by itself; targets only appear when there is a choice.
  const choosing = props.candidates.length > 1
  return (
    <View style={styles.screen}>
      <View testID="qr-scanner" onLayout={props.onLayout} style={[styles.preview, { borderRadius: tokens.radius.lg }]}>
        {props.preview}
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          {choosing && [...props.candidates].sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height).map((candidate) => {
            const { x, y, width, height } = qrTargetRect(candidate.rect, props.size)
            return (
              <Pressable
                key={candidate.id}
                accessibilityRole="button"
                accessibilityLabel={`${t('QR code')} ${candidate.id}`}
                onPress={() => props.onSelect(candidate)}
                style={[styles.target, { left: x, top: y, width, height }]}
              >
                <View pointerEvents="none" style={styles.number}>
                  <Text style={styles.numberText}>{candidate.id}</Text>
                </View>
              </Pressable>
            )
          })}
        </View>
      </View>
      {/* The hint keeps a fixed height: resizing the preview clears every target,
          and a hint that rewraps per state would resize it in a loop. */}
      <Text
        testID="qr-scanner-hint"
        accessibilityLiveRegion="polite"
        numberOfLines={HINT_LINES}
        style={[styles.hint, { color: tokens.colors.mutedForeground, height: HINT_LINES * HINT_LINE_HEIGHT * fontScale }]}
      >
        {t(props.error ? 'Could not start the camera. Please try again.'
          : choosing ? 'Several QR codes found. Tap the one you want to use.'
            : props.candidates.length ? 'Reading the QR code…' : 'Point the camera at a QR code.')}
      </Text>
      <View style={styles.actions}>
        {props.error ? <Button label="Try again" onPress={props.onRetry} /> : null}
        <Button label="Cancel scan" variant="secondary" onPress={props.onCancel} />
      </View>
    </View>
  )
}

const HINT_LINES = 2
const HINT_LINE_HEIGHT = 20

const styles = StyleSheet.create({
  screen: { flex: 1, gap: 12 },
  preview: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  // Camera targets need constant contrast over arbitrary light/dark imagery.
  target: { position: 'absolute', borderWidth: 3, borderColor: '#4ade80', borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000018' },
  number: { minWidth: 32, height: 32, paddingHorizontal: 6, borderRadius: 16, backgroundColor: '#4ade80', alignItems: 'center', justifyContent: 'center' },
  numberText: { color: '#052e16', fontSize: 16, fontWeight: '700' },
  hint: { fontSize: 14, lineHeight: HINT_LINE_HEIGHT, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 12, justifyContent: 'center' },
})
