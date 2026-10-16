import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
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
  return (
    <View style={styles.screen}>
      <View testID="qr-scanner" onLayout={props.onLayout} style={[styles.preview, { borderRadius: tokens.radius.lg }]}>
        {props.preview}
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          {[...props.candidates].sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height).map((candidate) => {
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
      <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: tokens.colors.mutedForeground }]}>
        {t(props.error ? 'Could not start the camera. Please try again.'
          : props.candidates.length ? 'Tap the QR code you want to use.' : 'Point the camera at QR codes, then tap one to select it.')}
      </Text>
      <View style={styles.actions}>
        {props.error ? <Button label="Try again" onPress={props.onRetry} /> : null}
        <Button label="Cancel scan" variant="secondary" onPress={props.onCancel} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, gap: 12 },
  preview: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  // Camera targets need constant contrast over arbitrary light/dark imagery.
  target: { position: 'absolute', borderWidth: 3, borderColor: '#4ade80', borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000018' },
  number: { minWidth: 32, height: 32, paddingHorizontal: 6, borderRadius: 16, backgroundColor: '#4ade80', alignItems: 'center', justifyContent: 'center' },
  numberText: { color: '#052e16', fontSize: 16, fontWeight: '700' },
  hint: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 12, justifyContent: 'center' },
})
