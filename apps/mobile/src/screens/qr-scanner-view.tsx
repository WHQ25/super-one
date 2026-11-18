import { Flashlight, Image as ImageIcon } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Image, Pressable, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native'
import { useMobileLocale } from '../i18n/context'
import { useMobileTheme } from '../theme/context'
import { Text } from '../ui/text'
import { qrTargetRect, type QrCandidate, type ScannerSize } from './qr-scanner-state'

export type QrScannerNotice = 'empty-image' | 'invalid-image' | null

export function QrScannerView(props: {
  preview: ReactNode
  candidates: QrCandidate[]
  size: ScannerSize
  error?: boolean
  torch?: boolean
  zoomed?: boolean
  photoUri?: string | null
  notice?: QrScannerNotice
  onLayout: (event: LayoutChangeEvent) => void
  onSelect: (candidate: QrCandidate) => void
  onToggleTorch?: () => void
  onToggleZoom?: () => void
  onPickPhoto?: () => void
  onClearPhoto?: () => void
  onCancel: () => void
  onRetry: () => void
}) {
  const { tokens } = useMobileTheme()
  const { t } = useMobileLocale()
  const { fontScale } = useWindowDimensions()
  const choosing = props.candidates.length > 1
  const liveControls = !props.error && !props.photoUri
  const hasSecondaryCenterAction = Boolean((props.photoUri && props.onClearPhoto) || props.error)
  const hintKey = choosing
    ? 'Several QR codes found. Tap the one you want to use.'
    : props.notice === 'empty-image'
      ? 'No QR code found in the selected image.'
      : props.notice === 'invalid-image'
        ? 'Could not read the selected image. Please try another photo.'
        : props.error
          ? 'Could not start the camera. Please try again.'
          : props.candidates.length
            ? 'Reading the QR code…'
            : 'Point the camera at a QR code.'
  return (
    <View style={styles.screen}>
      <View testID="qr-scanner" onLayout={props.onLayout} style={[styles.preview, { borderRadius: tokens.radius.lg }]}>
        {props.photoUri ? (
          <Image source={{ uri: props.photoUri }} resizeMode="contain" style={StyleSheet.absoluteFill} />
        ) : props.preview}
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
          <View pointerEvents="box-none" style={styles.bottomOverlay}>
            {liveControls && props.onToggleTorch ? (
              <Pressable
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t(props.torch ? 'Turn off flashlight' : 'Turn on flashlight')}
                accessibilityState={{ selected: Boolean(props.torch) }}
                onPress={props.onToggleTorch}
                style={({ pressed }) => [styles.torchButton, pressed && styles.pressed]}
              >
                <Flashlight
                  color={props.torch ? '#4ade80' : '#ffffffcc'}
                  size={24}
                  strokeWidth={props.torch ? 2.2 : 1.75}
                />
              </Pressable>
            ) : null}
            <View pointerEvents="none" style={styles.hintWrap}>
              <Text
                testID="qr-scanner-hint"
                accessibilityLiveRegion="polite"
                numberOfLines={HINT_LINES}
                style={[styles.hint, { height: HINT_LINES * HINT_LINE_HEIGHT * fontScale }]}
              >
                {t(hintKey)}
              </Text>
            </View>
            <View pointerEvents="box-none" style={styles.bottomBar}>
              <View pointerEvents="box-none" style={styles.sideSlot}>
                {props.onPickPhoto ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('Choose photo')}
                    onPress={props.onPickPhoto}
                    style={({ pressed }) => [styles.circleButton, pressed && styles.pressed]}
                  >
                    <ImageIcon color="#ffffff" size={20} strokeWidth={1.9} />
                  </Pressable>
                ) : null}
              </View>
              <View pointerEvents="box-none" style={styles.centerActions}>
                {props.photoUri && props.onClearPhoto ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={props.onClearPhoto}
                    style={({ pressed }) => [
                      styles.centerButton,
                      hasSecondaryCenterAction && styles.centerButtonCompact,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.centerButtonText}>{t('Use camera')}</Text>
                  </Pressable>
                ) : props.error ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={props.onRetry}
                    style={({ pressed }) => [
                      styles.centerButton,
                      styles.retryButton,
                      hasSecondaryCenterAction && styles.centerButtonCompact,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.centerButtonText, styles.retryButtonText]}>{t('Try again')}</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={props.onCancel}
                  style={({ pressed }) => [
                    styles.centerButton,
                    hasSecondaryCenterAction && styles.centerButtonCompact,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.centerButtonText}>{t('Cancel scan')}</Text>
                </Pressable>
              </View>
              <View pointerEvents="box-none" style={styles.sideSlot}>
                {liveControls && props.onToggleZoom ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t(props.zoomed ? 'Reset zoom' : 'Zoom in')}
                    accessibilityState={{ selected: Boolean(props.zoomed) }}
                    onPress={props.onToggleZoom}
                    style={({ pressed }) => [
                      styles.circleButton,
                      props.zoomed && styles.circleActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.zoomLabel, props.zoomed && styles.circleActiveText]}>
                      {props.zoomed ? '2×' : '1×'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}

const HINT_LINES = 2
const HINT_LINE_HEIGHT = 20

const styles = StyleSheet.create({
  screen: { flex: 1 },
  preview: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  target: { position: 'absolute', borderWidth: 3, borderColor: '#4ade80', borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000018' },
  number: { minWidth: 32, height: 32, paddingHorizontal: 6, borderRadius: 16, backgroundColor: '#4ade80', alignItems: 'center', justifyContent: 'center' },
  numberText: { color: '#052e16', fontSize: 16, fontWeight: '700' },
  bottomOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingBottom: 20, alignItems: 'center', gap: 10 },
  torchButton: { width: 48, height: 48, marginBottom: 6, alignItems: 'center', justifyContent: 'center', shadowColor: '#000000', shadowOpacity: 0.65, shadowRadius: 6, shadowOffset: { width: 0, height: 1 } },
  hintWrap: { alignSelf: 'stretch' },
  hint: { color: '#ffffffe6', fontSize: 14, lineHeight: HINT_LINE_HEIGHT, textAlign: 'center', paddingHorizontal: 12, textShadowColor: '#000000cc', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  bottomBar: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sideSlot: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  circleButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#0000007a', borderWidth: 1, borderColor: '#ffffff29', alignItems: 'center', justifyContent: 'center' },
  circleActive: { backgroundColor: '#4ade80', borderColor: '#4ade80' },
  circleActiveText: { color: '#052e16' },
  zoomLabel: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  centerActions: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  centerButton: { minHeight: 44, paddingHorizontal: 22, borderRadius: 22, backgroundColor: '#0000007a', borderWidth: 1, borderColor: '#ffffff29', alignItems: 'center', justifyContent: 'center' },
  centerButtonCompact: { paddingHorizontal: 14 },
  centerButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  retryButton: { backgroundColor: '#ffffffeb', borderColor: '#ffffff' },
  retryButtonText: { color: '#111111' },
  pressed: { opacity: 0.72 },
})
