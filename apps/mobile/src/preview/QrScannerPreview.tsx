import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { SvgXml } from 'react-native-svg'
import { useMobileLocale } from '../i18n/context'
import { QrScannerView } from '../screens/qr-scanner-view'
import type { QrCandidate, ScannerSize } from '../screens/qr-scanner-state'
import { useMobileTheme } from '../theme/context'
import { Button } from '../ui'
import { Text } from '../ui/text'
import { qrScannerFixtures } from './qr-scanner-fixtures'

/** Offline camera scene using the production picker; no pairing or URL side effects. */
export function QrScannerFixture({ count = 2, error = false }: { count?: number; error?: boolean }) {
  const [size, setSize] = useState<ScannerSize>({ width: 0, height: 0 })
  const [selected, setSelected] = useState<number | null>(null)
  const { t } = useMobileLocale()
  const candidates: QrCandidate[] = qrScannerFixtures.slice(0, error ? 0 : count).map((fixture, index) => {
    const side = size.width * (index ? 0.28 : 0.48)
    const rect = { x: size.width * (index ? 0.66 : 0.06), y: size.height * (index ? 0.42 : 0.34), width: side, height: side }
    return { id: index + 1, rect, seenAt: Date.now(), result: {
      type: 'qr', data: fixture.data, cornerPoints: [], bounds: { origin: { x: rect.x, y: rect.y }, size: rect },
    } }
  })
  return <View style={{ flex: 1 }}>
    <QrScannerView size={size} candidates={candidates} error={error}
      onLayout={({ nativeEvent: { layout } }) => setSize(layout)}
      onSelect={(candidate) => setSelected(candidate.id)}
      onCancel={() => setSelected(null)} onRetry={() => setSelected(null)}
      preview={<View style={[StyleSheet.absoluteFill, { backgroundColor: '#262626' }]}>
        {candidates.map(({ id, rect }) => <View key={id} style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
          <SvgXml xml={qrScannerFixtures[id - 1]!.svg} width="100%" height="100%" />
        </View>)}
      </View>}
    />
    {selected !== null ? <Text testID="selected-qr" style={{ textAlign: 'center', padding: 8 }}>{t('QR code')} {selected} ✓</Text> : null}
  </View>
}

export function QrScannerPreview({ onClose }: { onClose: () => void }) {
  const { tokens } = useMobileTheme()
  return <SafeAreaView style={{ flex: 1, backgroundColor: tokens.colors.background, paddingHorizontal: 16, paddingBottom: 12 }}>
    <StatusBar style={tokens.scheme === 'dark' ? 'light' : 'dark'} />
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
      <Button label="Close preview" variant="ghost" onPress={onClose} />
      <Text style={{ color: tokens.colors.mutedForeground, fontSize: 12, flex: 1, textAlign: 'right' }}>Offline UI preview</Text>
    </View>
    <QrScannerFixture />
  </SafeAreaView>
}
